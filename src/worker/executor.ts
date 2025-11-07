import { Job, JobDefinition, JobContext } from '../types';
import { createJobEvent, updateJobStatus, incrementAttempts, scheduleRetry, updateHeartbeat, getJobById } from '../db/jobs';

export function calculateBackoffDelay(attempt: number, baseSeconds: number = 1, maxSeconds: number = 3600): number {
  const exponentialDelay = baseSeconds * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
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
    cancelCheckInterval = setInterval(async () => {
      const currentJob = await getJobById(job.id);
      if (currentJob?.cancelRequestedAt) {
        abortController.abort();
        await updateJobStatus(job.id, 'cancelling');
      }
    }, 1000);

    // Execute the job
    await definition.run(job.params, context);

    // Success path
    clearInterval(heartbeatInterval);
    clearInterval(cancelCheckInterval);
    await updateJobStatus(job.id, 'succeeded');
    await createJobEvent(job.id, 'succeeded');
    
    if (definition.onSuccess) {
      await definition.onSuccess(context);
    }
    if (definition.onEnd) {
      await definition.onEnd(context);
    }
  } catch (error) {
    clearInterval(heartbeatInterval);
    clearInterval(cancelCheckInterval);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorSummary = errorMessage.length > 500 ? errorMessage.substring(0, 500) : errorMessage;
    
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
      // Max attempts reached
      await updateJobStatus(job.id, 'failed', errorSummary);
      await createJobEvent(job.id, 'failed', { error: errorSummary, attempts: updatedJob.attempts });
      
      if (definition.onFail) {
        await definition.onFail({ ...context, error });
      }
      if (definition.onEnd) {
        await definition.onEnd(context);
      }
    }
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

