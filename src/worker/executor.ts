import { Job, JobDefinition, JobContext } from '../types';
import { createJobEvent, updateJobStatus, incrementAttempts, scheduleRetry, updateHeartbeat, getJobById, moveJobToDlq } from '../db/jobs';

export function calculateBackoffDelay(
  attempt: number, 
  baseSeconds: number = parseInt(process.env.BACKOFF_BASE_SECONDS || '1', 10),
  maxSeconds: number = parseInt(process.env.BACKOFF_MAX_SECONDS || '3600', 10)
): number {
  const jitterPercent = parseFloat(process.env.BACKOFF_JITTER_PERCENT || '0.3');
  const exponentialDelay = baseSeconds * Math.pow(2, attempt);
  const jitter = Math.random() * jitterPercent * exponentialDelay;
  return Math.min(maxSeconds, exponentialDelay + jitter);
}

export async function executeJob(
  job: Job,
  definition: JobDefinition,
  workerId: string,
  leaseDurationSeconds: number
): Promise<void> {
  const abortController = new AbortController();
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let cancelCheckInterval: NodeJS.Timeout | null = null;
  
  const context: JobContext = {
    jobId: job.id,
    abortSignal: abortController.signal,
    logger: {
      info: (message: string, meta?: Record<string, unknown>) => {
        console.log(`[${job.id}] ${message}`, meta || '');
      },
      error: (message: string, meta?: Record<string, unknown>) => {
        console.error(`[${job.id}] ${message}`, meta || '');
      },
      warn: (message: string, meta?: Record<string, unknown>) => {
        console.warn(`[${job.id}] ${message}`, meta || '');
      },
    },
    emitEvent: async (type: string, payload?: unknown) => {
      await createJobEvent(job.id, type, payload as Record<string, unknown> | undefined);
    },
  };

  try {
    // Check if cancellation was already requested before starting
    if (job.cancelRequestedAt) {
      console.log(`[${job.id}] Job already cancelled before execution started`);
      await updateJobStatus(job.id, 'cancelled');
      await createJobEvent(job.id, 'cancelled', { reason: 'cancelled_before_execution' });
      return;
    }
    
    // Emit started event
    await createJobEvent(job.id, 'started');
    
    // Call onStart hook if present
    if (definition.onStart) {
      await definition.onStart(context);
    }

    // Set up heartbeat
    heartbeatInterval = setInterval(async () => {
      try {
        await updateHeartbeat(job.id, leaseDurationSeconds);
        await createJobEvent(job.id, 'heartbeat');
      } catch (error) {
        console.error(`[${job.id}] Failed to update heartbeat:`, error);
      }
    }, (leaseDurationSeconds / 2) * 1000); // Heartbeat at half lease duration

    // Check for cancellation requests
    const cancelCheckIntervalMs = parseInt(process.env.CANCEL_CHECK_INTERVAL_MS || '1000', 10);
    cancelCheckInterval = setInterval(async () => {
      try {
        const currentJob = await getJobById(job.id);
        if (currentJob?.cancelRequestedAt) {
          abortController.abort();
          await updateJobStatus(job.id, 'cancelling');
        }
      } catch (error) {
        console.error(`[${job.id}] Failed to check cancellation:`, error);
      }
    }, cancelCheckIntervalMs);

    // Execute the job
    await definition.run(job.params, context);

    // Success path - clear intervals first
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (cancelCheckInterval) {
      clearInterval(cancelCheckInterval);
      cancelCheckInterval = null;
    }
    
    // Update status and emit events
    await updateJobStatus(job.id, 'succeeded');
    await createJobEvent(job.id, 'succeeded');
    
    // Call lifecycle hooks
    try {
      if (definition.onSuccess) {
        await definition.onSuccess(context);
      }
    } catch (error) {
      console.error(`[${job.id}] Error in onSuccess hook:`, error);
    }
    
    try {
      if (definition.onEnd) {
        await definition.onEnd(context);
      }
    } catch (error) {
      console.error(`[${job.id}] Error in onEnd hook:`, error);
    }
  } catch (error) {
    // Clear intervals on error
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (cancelCheckInterval) {
      clearInterval(cancelCheckInterval);
      cancelCheckInterval = null;
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorSummary = errorMessage.length > 500 ? errorMessage.substring(0, 500) : errorMessage;
    
    console.error(`[${job.id}] Job execution failed:`, error);
    
    // Check if job is being cancelled
    const currentJob = await getJobById(job.id);
    if (currentJob?.status === 'cancelling' || currentJob?.cancelRequestedAt) {
      console.log(`[${job.id}] Job was cancelled, marking as cancelled`);
      await updateJobStatus(job.id, 'cancelled', 'Job was cancelled');
      await createJobEvent(job.id, 'cancelled', { reason: 'cancelled_during_execution' });
      return; // Don't retry or fail
    }
    
    await incrementAttempts(job.id);
    const updatedJob = await getJobById(job.id);
    
    if (!updatedJob) {
      throw new Error('Job not found after incrementing attempts');
    }

    if (updatedJob.attempts < updatedJob.maxAttempts) {
      // Schedule retry
      const backoffSeconds = calculateBackoffDelay(updatedJob.attempts);
      const scheduledAt = new Date(Date.now() + backoffSeconds * 1000);
      await scheduleRetry(job.id, scheduledAt);
      await createJobEvent(job.id, 'failed', { 
        error: errorSummary, 
        retryScheduledAt: scheduledAt.toISOString(),
        attempts: updatedJob.attempts 
      });
    } else {
      // Max attempts reached - move to DLQ
      console.log(`[${job.id}] Max attempts reached, moving to DLQ`);
      
      // Create event before moving to DLQ (since job will be deleted)
      await createJobEvent(job.id, 'moved_to_dlq', { 
        error: errorSummary, 
        attempts: updatedJob.attempts
      });
      
      try {
        const dlqJob = await moveJobToDlq(updatedJob, errorSummary);
        console.log(`[${job.id}] Job moved to DLQ: ${dlqJob.id}`);
      } catch (dlqError) {
        // If moving to DLQ fails, fall back to marking as failed
        console.error(`[${job.id}] Failed to move job to DLQ:`, dlqError);
      await updateJobStatus(job.id, 'failed', errorSummary);
        await createJobEvent(job.id, 'failed', { 
          error: errorSummary, 
          attempts: updatedJob.attempts,
          dlqError: dlqError instanceof Error ? dlqError.message : String(dlqError)
        });
      }
      
      try {
        if (definition.onFail) {
          await definition.onFail({ ...context, error });
        }
      } catch (hookError) {
        console.error(`[${job.id}] Error in onFail hook:`, hookError);
      }
      
      try {
        if (definition.onEnd) {
          await definition.onEnd(context);
        }
      } catch (hookError) {
        console.error(`[${job.id}] Error in onEnd hook:`, hookError);
      }
    }
    
    // Re-throw to ensure the promise rejects
    throw error;
  }
}

export async function handleCancellation(
  job: Job,
  definition: JobDefinition,
  gracePeriodMs: number
): Promise<void> {
  // If job is already cancelled, return
  if (job.status === 'cancelled') {
    return;
  }

  // Wait for grace period
  await new Promise(resolve => setTimeout(resolve, gracePeriodMs));

  // Check if still cancelling
  const currentJob = await getJobById(job.id);
  if (currentJob?.status === 'cancelling') {
    await updateJobStatus(job.id, 'cancelled');
    await createJobEvent(job.id, 'cancelled');
    
    const context: JobContext = {
      jobId: job.id,
      abortSignal: new AbortController().signal,
      logger: {
        info: () => {},
        error: () => {},
        warn: () => {},
      },
      emitEvent: async () => {},
    };
    
    if (definition.onEnd) {
      await definition.onEnd(context);
    }
  }
}

