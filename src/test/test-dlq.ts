import 'dotenv/config';
import { getPool } from '../db/connection';
import { createJob, createJobDefinition, listDlqJobs, getDlqJobById, retryDlqJob } from '../db/jobs';
import { getWorker } from '../worker/index';
import { jobRegistry } from '../worker/registry';
import { runMigrations } from '../db/migrations';

// Test colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to clear jobs and DLQ
async function clearJobs(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM job_events');
  await pool.query('DELETE FROM jobs_dlq');
  await pool.query('DELETE FROM jobs');
}

async function test1_JobMovesToDlqOnMaxAttempts() {
  log('\n=== Test 1: Job Moves to DLQ on Max Attempts ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('failing', 1, 1, 3600, 0); // maxAttempts = 1 (moves to DLQ immediately)
    
    // Register failing job definition
    jobRegistry.register({
      key: 'failing',
      version: 1,
      defaultMaxAttempts: 1,
      run: async (params, ctx) => {
        ctx.logger.info('Failing job started');
        throw new Error('Intentional failure');
      },
    });
    
    // Start worker
    const worker = getWorker();
    await worker.start();
    log('✓ Worker started', colors.green);
    
    // Create a failing job
    const job = await createJob({
      definitionKey: 'failing',
      definitionVersion: 1,
      params: { test: 'dlq' },
    });
    log(`✓ Created failing job: ${job.id}`, colors.green);
    
    // Wait for job to fail and move to DLQ (with maxAttempts=1, should happen quickly)
    let dlqJob = null;
    let attempts = 0;
    const maxAttempts = 10; // Wait up to 10 seconds
    
    while (!dlqJob && attempts < maxAttempts) {
      await sleep(1000);
      attempts++;
      
      const dlqJobs = await listDlqJobs();
      dlqJob = dlqJobs.find(j => j.originalJobId === job.id);
      
      if (dlqJob) {
        break;
      }
    }
    
    if (!dlqJob) {
      log('✗ Job not found in DLQ after waiting', colors.red);
      await worker.stop();
      return false;
    }
    
    log(`✓ Job moved to DLQ: ${dlqJob.id}`, colors.green);
    
    if (dlqJob.errorSummary !== 'Intentional failure') {
      log(`✗ Error summary incorrect: ${dlqJob.errorSummary}`, colors.red);
      await worker.stop();
      return false;
    }
    
    log('✓ Error summary correct', colors.green);
    
    // Verify job is removed from main table
    const pool = getPool();
    const mainJob = await pool.query('SELECT * FROM jobs WHERE id = $1', [job.id]);
    if (mainJob.rows.length > 0) {
      log('✗ Job still exists in main jobs table', colors.red);
      await worker.stop();
      return false;
    }
    
    log('✓ Job removed from main jobs table', colors.green);
    
    await worker.stop();
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test2_ListDlqJobs() {
  log('\n=== Test 2: List DLQ Jobs ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('test', 1, 1, 3600, 0);
    
    // Manually create DLQ entries for testing
    const pool = getPool();
    const job1 = await createJob({
      definitionKey: 'test',
      definitionVersion: 1,
      params: { test: 1 },
    });
    const job2 = await createJob({
      definitionKey: 'test',
      definitionVersion: 1,
      params: { test: 2 },
    });
    
    // Manually move jobs to DLQ
    const { moveJobToDlq } = await import('../db/jobs');
    const dlqJob1 = await moveJobToDlq(job1, 'Test error 1');
    const dlqJob2 = await moveJobToDlq(job2, 'Test error 2');
    
    log(`✓ Created 2 DLQ jobs`, colors.green);
    
    // List all DLQ jobs
    const allDlqJobs = await listDlqJobs();
    if (allDlqJobs.length < 2) {
      log(`✗ Expected at least 2 DLQ jobs, got ${allDlqJobs.length}`, colors.red);
      return false;
    }
    
    log(`✓ Found ${allDlqJobs.length} DLQ jobs`, colors.green);
    
    // List by definition key
    const testDlqJobs = await listDlqJobs('test');
    if (testDlqJobs.length < 2) {
      log(`✗ Expected at least 2 DLQ jobs for 'test', got ${testDlqJobs.length}`, colors.red);
      return false;
    }
    
    log(`✓ Found ${testDlqJobs.length} DLQ jobs for 'test' definition`, colors.green);
    
    // List with limit
    const limitedDlqJobs = await listDlqJobs(undefined, 1);
    if (limitedDlqJobs.length !== 1) {
      log(`✗ Expected 1 DLQ job with limit=1, got ${limitedDlqJobs.length}`, colors.red);
      return false;
    }
    
    log('✓ Limit works correctly', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test3_GetDlqJobById() {
  log('\n=== Test 3: Get DLQ Job By ID ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('test', 1, 1, 3600, 0);
    
    const job = await createJob({
      definitionKey: 'test',
      definitionVersion: 1,
      params: { test: 'get-by-id' },
    });
    
    const { moveJobToDlq } = await import('../db/jobs');
    const dlqJob = await moveJobToDlq(job, 'Test error');
    
    log(`✓ Created DLQ job: ${dlqJob.id}`, colors.green);
    
    const retrieved = await getDlqJobById(dlqJob.id);
    if (!retrieved) {
      log('✗ DLQ job not found', colors.red);
      return false;
    }
    
    if (retrieved.id !== dlqJob.id) {
      log('✗ Retrieved DLQ job ID mismatch', colors.red);
      return false;
    }
    
    if (retrieved.originalJobId !== job.id) {
      log('✗ Original job ID mismatch', colors.red);
      return false;
    }
    
    log('✓ DLQ job retrieved correctly', colors.green);
    
    // Test non-existent job
    const notFound = await getDlqJobById('00000000-0000-0000-0000-000000000000');
    if (notFound !== null) {
      log('✗ Non-existent DLQ job should return null', colors.red);
      return false;
    }
    
    log('✓ Non-existent DLQ job returns null', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test4_RetryDlqJob() {
  log('\n=== Test 4: Retry DLQ Job ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Register echo job
    jobRegistry.register({
      key: 'echo',
      version: 1,
      run: async (params, ctx) => {
        ctx.logger.info('Echo job started', params);
        await new Promise(resolve => setTimeout(resolve, 100));
        ctx.logger.info('Echo job completed', params);
      },
    });
    
    const job = await createJob({
      definitionKey: 'echo',
      definitionVersion: 1,
      params: { test: 'retry' },
      priority: 5,
    });
    
    const { moveJobToDlq } = await import('../db/jobs');
    const dlqJob = await moveJobToDlq(job, 'Test error');
    
    log(`✓ Created DLQ job: ${dlqJob.id}`, colors.green);
    
    // Retry the DLQ job
    const newJob = await retryDlqJob(dlqJob.id);
    
    if (!newJob) {
      log('✗ Retry did not create new job', colors.red);
      return false;
    }
    
    log(`✓ Created new job from DLQ: ${newJob.id}`, colors.green);
    
    // Verify new job has correct properties
    if (newJob.definitionKey !== dlqJob.definitionKey) {
      log('✗ Definition key mismatch', colors.red);
      return false;
    }
    
    if (newJob.priority !== dlqJob.priority) {
      log('✗ Priority mismatch', colors.red);
      return false;
    }
    
    log('✓ New job has correct properties', colors.green);
    
    // Test retry with custom maxAttempts
    const dlqJob2 = await moveJobToDlq(newJob, 'Test error 2');
    const newJob2 = await retryDlqJob(dlqJob2.id, 5);
    
    if (newJob2.maxAttempts !== 5) {
      log(`✗ Custom maxAttempts not applied: expected 5, got ${newJob2.maxAttempts}`, colors.red);
      return false;
    }
    
    log('✓ Custom maxAttempts applied correctly', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test5_DlqJobPreservesMetadata() {
  log('\n=== Test 5: DLQ Job Preserves Metadata ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('test', 1, 3, 3600, 0);
    
    const job = await createJob({
      definitionKey: 'test',
      definitionVersion: 1,
      params: { test: 'metadata' },
      priority: 10,
      idempotencyKey: 'test-idempotency',
    });
    
    // Update job to simulate execution
    const pool = getPool();
    await pool.query(
      `UPDATE jobs SET attempts = 3, started_at = NOW() WHERE id = $1`,
      [job.id]
    );
    
    const updatedJob = await pool.query('SELECT * FROM jobs WHERE id = $1', [job.id]);
    const jobData = updatedJob.rows[0];
    
    const { moveJobToDlq } = await import('../db/jobs');
    const dlqJob = await moveJobToDlq({
      id: jobData.id,
      definitionKey: jobData.definition_key,
      definitionVersion: jobData.definition_version,
      params: jobData.params,
      status: jobData.status,
      priority: jobData.priority,
      attempts: jobData.attempts,
      maxAttempts: jobData.max_attempts,
      scheduledAt: jobData.scheduled_at,
      queuedAt: jobData.queued_at,
      startedAt: jobData.started_at,
      finishedAt: jobData.finished_at,
      heartbeatAt: jobData.heartbeat_at,
      leaseExpiresAt: jobData.lease_expires_at,
      cancelRequestedAt: jobData.cancel_requested_at,
      workerId: jobData.worker_id,
      idempotencyKey: jobData.idempotency_key,
      errorSummary: jobData.error_summary,
    }, 'Test error');
    
    // Verify metadata is preserved
    if (dlqJob.priority !== 10) {
      log(`✗ Priority not preserved: expected 10, got ${dlqJob.priority}`, colors.red);
      return false;
    }
    
    if (dlqJob.attempts !== 3) {
      log(`✗ Attempts not preserved: expected 3, got ${dlqJob.attempts}`, colors.red);
      return false;
    }
    
    if (dlqJob.idempotencyKey !== 'test-idempotency') {
      log(`✗ Idempotency key not preserved`, colors.red);
      return false;
    }
    
    if (dlqJob.params?.test !== 'metadata') {
      log(`✗ Params not preserved`, colors.red);
      return false;
    }
    
    log('✓ All metadata preserved correctly', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('DEAD-LETTER QUEUE COMPREHENSIVE TEST SUITE', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  try {
    // Run migrations
    log('\nRunning migrations...', colors.blue);
    await runMigrations();
    log('✓ Migrations completed', colors.green);
    
    // Register test job definitions
    log('\nRegistering job definitions...', colors.blue);
    await createJobDefinition('failing', 1, 1, 3600, 0);
    await createJobDefinition('test', 1, 1, 3600, 0);
    await createJobDefinition('echo', 1, 3, 3600, 0);
    log('✓ Job definitions registered', colors.green);
    
    const tests = [
      test1_JobMovesToDlqOnMaxAttempts,
      test2_ListDlqJobs,
      test3_GetDlqJobById,
      test4_RetryDlqJob,
      test5_DlqJobPreservesMetadata,
    ];
    
    const results: boolean[] = [];
    
    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);
      } catch (error: any) {
        log(`✗ Test failed with exception: ${error.message}`, colors.red);
        log(error.stack, colors.red);
        results.push(false);
      }
    }
    
    // Summary
    log('\n' + '='.repeat(60), colors.cyan);
    log('TEST SUMMARY', colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    log(`\nTotal tests: ${total}`, colors.blue);
    log(`Passed: ${passed}`, colors.green);
    log(`Failed: ${total - passed}`, colors.red);
    
    if (passed === total) {
      log('\n✓ All tests passed!', colors.green);
    } else {
      log(`\n✗ ${total - passed} test(s) failed`, colors.red);
    }
    
    // Cleanup
    await clearJobs();
    
    return passed === total;
  } catch (error: any) {
    log(`\n✗ Fatal error: ${error.message}`, colors.red);
    log(error.stack, colors.red);
    return false;
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runAllTests };

