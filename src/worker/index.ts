import 'dotenv/config';
import { claimJob, getJobById, reclaimOrphanedJobs, updateJobStatus } from '../db/jobs';
import { jobRegistry } from './registry';
import { executeJob, handleCancellation } from './executor';
import { runMigrations } from '../db/migrations';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const MAX_CONCURRENT_EXECUTIONS = parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '10', 10);
const LEASE_DURATION_SECONDS = parseInt(process.env.LEASE_DURATION_SECONDS || '60', 10);
const HEARTBEAT_INTERVAL_SECONDS = parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '10', 10);
const CANCEL_GRACE_MS = parseInt(process.env.CANCEL_GRACE_MS || '5000', 10);
const POLL_INTERVAL_MS = 1000;

class Worker {
  private running = false;
  private activeExecutions = new Map<string, Promise<void>>();
  private pollInterval: NodeJS.Timeout | null = null;
  private orphanRecoveryInterval: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log(`[${WORKER_ID}] Starting worker with max ${MAX_CONCURRENT_EXECUTIONS} concurrent executions`);

    // Start polling for jobs
    this.pollInterval = setInterval(() => {
      this.pollForJobs().catch((error) => {
        console.error(`[${WORKER_ID}] Error polling for jobs:`, error);
      });
    }, POLL_INTERVAL_MS);

    // Reclaim orphaned jobs periodically
    this.orphanRecoveryInterval = setInterval(() => {
      this.reclaimOrphans().catch((error) => {
        console.error(`[${WORKER_ID}] Error reclaiming orphans:`, error);
      });
    }, LEASE_DURATION_SECONDS * 1000);

    // Initial poll
    await this.pollForJobs();
    await this.reclaimOrphans();
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    if (this.orphanRecoveryInterval) {
      clearInterval(this.orphanRecoveryInterval);
      this.orphanRecoveryInterval = null;
    }

    // Wait for active executions to complete
    console.log(`[${WORKER_ID}] Waiting for ${this.activeExecutions.size} active executions to complete...`);
    await Promise.allSettled(Array.from(this.activeExecutions.values()));
    
    console.log(`[${WORKER_ID}] Worker stopped`);
  }

  private async pollForJobs(): Promise<void> {
    if (this.activeExecutions.size >= MAX_CONCURRENT_EXECUTIONS) {
      return;
    }

    const job = await claimJob(WORKER_ID, LEASE_DURATION_SECONDS);
    if (!job) {
      return;
    }

    const definition = jobRegistry.get(job.definitionKey, job.definitionVersion);
    if (!definition) {
      console.error(`[${WORKER_ID}] No definition found for ${job.definitionKey}@${job.definitionVersion}`);
      await updateJobStatus(job.id, 'failed', `No definition found for ${job.definitionKey}@${job.definitionVersion}`);
      return;
    }

    // Check if cancellation was requested before starting
    if (job.cancelRequestedAt) {
      await handleCancellation(job, definition, CANCEL_GRACE_MS);
      return;
    }

    // Execute job asynchronously
    const executionPromise = executeJob(job, definition, WORKER_ID, LEASE_DURATION_SECONDS)
      .catch((error) => {
        console.error(`[${WORKER_ID}] Execution error for job ${job.id}:`, error);
      })
      .finally(() => {
        this.activeExecutions.delete(job.id);
      });

    this.activeExecutions.set(job.id, executionPromise);
  }

  private async reclaimOrphans(): Promise<void> {
    const reclaimed = await reclaimOrphanedJobs(LEASE_DURATION_SECONDS);
    if (reclaimed > 0) {
      console.log(`[${WORKER_ID}] Reclaimed ${reclaimed} orphaned jobs`);
    }
  }
}

let workerInstance: Worker | null = null;

export function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker();
  }
  return workerInstance;
}

// Example job definitions - these would typically be imported from separate modules
async function registerExampleJobs() {
  // Example: Simple echo job
  jobRegistry.register({
    key: 'echo',
    version: 1,
    run: async (params, ctx) => {
      ctx.logger.info('Echo job started', params);
      await new Promise(resolve => setTimeout(resolve, 1000));
      ctx.logger.info('Echo job completed', params);
    },
  });

  // Example: Failing job for testing retries
  jobRegistry.register({
    key: 'failing',
    version: 1,
    defaultMaxAttempts: 3,
    run: async (params, ctx) => {
      ctx.logger.info('Failing job started');
      throw new Error('Intentional failure');
    },
  });
}

async function main() {
  try {
    // Run migrations
    await runMigrations();
    
    // Register job definitions
    await registerExampleJobs();
    
    // Start worker
    const worker = getWorker();
    await worker.start();
    
    console.log('Worker started. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${WORKER_ID}] Received SIGTERM, shutting down gracefully...`);
  if (workerInstance) {
    await workerInstance.stop();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${WORKER_ID}] Received SIGINT, shutting down gracefully...`);
  if (workerInstance) {
    await workerInstance.stop();
  }
  process.exit(0);
});

if (require.main === module) {
  main();
}

