import 'dotenv/config';
import { getJobById, updateJobStatus } from '../db/jobs';
import { dynamicJobRegistry } from './dynamic-registry';
import { executeJob, handleCancellation } from './executor';
import { runMigrations } from '../db/migrations';

const WORKER_ID = process.env.WORKER_ID || `single-job-worker-${process.pid}`;
const LEASE_DURATION_SECONDS = parseInt(process.env.LEASE_DURATION_SECONDS || '60', 10);
const CANCEL_GRACE_MS = parseInt(process.env.CANCEL_GRACE_MS || '5000', 10);

/**
 * Single-job worker that executes one job and exits.
 * This provides isolation - if a job crashes, only this process dies.
 */
async function main() {
  const jobId = process.argv[2];
  
  if (!jobId) {
    console.error('Usage: single-job-worker.ts <jobId>');
    process.exit(1);
  }

  try {
    // Run migrations (lightweight check)
    await runMigrations();
    
    // Load job definitions dynamically
    await dynamicJobRegistry.syncWithDatabase();
    
    // Get the job
    const job = await getJobById(jobId);
    if (!job) {
      console.error(`[${WORKER_ID}] Job ${jobId} not found`);
      process.exit(1);
    }

    // Get the job definition
    const definition = dynamicJobRegistry.get(job.definitionKey, job.definitionVersion);
    if (!definition) {
      console.error(`[${WORKER_ID}] No definition found for ${job.definitionKey}@${job.definitionVersion}`);
      await updateJobStatus(job.id, 'failed', `No definition found for ${job.definitionKey}@${job.definitionVersion}`);
      process.exit(1);
    }

    // Check if cancellation was requested before starting
    if (job.cancelRequestedAt) {
      await handleCancellation(job, definition, CANCEL_GRACE_MS);
      process.exit(0);
    }

    // Execute the job
    await executeJob(job, definition, WORKER_ID, LEASE_DURATION_SECONDS);
    
    console.log(`[${WORKER_ID}] Job ${jobId} completed successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`[${WORKER_ID}] Job ${jobId} failed:`, error);
    // Error handling is done in executeJob, so we just exit with error code
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(`[${WORKER_ID}] Uncaught exception:`, error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${WORKER_ID}] Unhandled rejection at:`, promise, 'reason:', reason);
  process.exit(1);
});

if (require.main === module) {
  main();
}

