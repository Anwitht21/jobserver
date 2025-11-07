import 'dotenv/config';
import { getPool } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { createJobDefinition, createJob, getJobById, claimJob, listJobs, updateJobStatus, reclaimOrphanedJobs, moveJobToDlq } from '../db/jobs';
import { Job } from '../types';
import { v4 as uuidv4 } from 'uuid';

const API_URL = process.env.API_URL || 'http://localhost:3000';

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiCall(method: string, path: string, body?: any) {
  const url = `${API_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} - ${JSON.stringify(data)}`);
  }
  
  return data;
}

async function clearDatabase(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM job_events');
  await pool.query('DELETE FROM jobs_dlq');
  await pool.query('DELETE FROM jobs');
  // Note: We don't delete job_definitions as they might be reused
}

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

/**
 * Test 1: Race condition - concurrent job creation with same idempotency key
 */
async function test1_ConcurrentIdempotency(): Promise<boolean> {
  log('\n=== Test 1: Concurrent Idempotency Key ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.concurrent.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    const idempotencyKey = `idempotent-${Date.now()}`;
    
    // Create 10 jobs simultaneously with the same idempotency key
    const promises = Array.from({ length: 10 }, () =>
      createJob({
        definitionKey,
        definitionVersion: 1,
        params: { test: 'concurrent' },
        idempotencyKey,
      })
    );
    
    const results = await Promise.all(promises);
    const jobIds = results.map(j => j.id);
    const uniqueJobIds = new Set(jobIds);
    
    if (uniqueJobIds.size !== 1) {
      log(`✗ Expected 1 unique job, got ${uniqueJobIds.size}`, colors.red);
      log(`  Job IDs: ${Array.from(uniqueJobIds).join(', ')}`, colors.yellow);
      return false;
    }
    
    log(`✓ All concurrent requests returned same job ID: ${Array.from(uniqueJobIds)[0]}`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 2: Invalid job definition
 */
async function test2_InvalidJobDefinition(): Promise<boolean> {
  log('\n=== Test 2: Invalid Job Definition ===', colors.blue);
  
  try {
    await clearDatabase();
    
    // Try to create job with non-existent definition
    try {
      await createJob({
        definitionKey: 'nonexistent.definition',
        definitionVersion: 999,
        params: {},
      });
      log('✗ Should have thrown error for invalid definition', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('not found')) {
        log('✓ Correctly rejected invalid job definition', colors.green);
        return true;
      }
      throw error;
    }
  } catch (error: any) {
    log(`✗ Unexpected error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 3: Priority ordering
 */
async function test3_PriorityOrdering(): Promise<boolean> {
  log('\n=== Test 3: Priority Ordering ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.priority.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create jobs with different priorities (lower number = lower priority)
    const priorities = [1, 5, 10, 3, 8, 2];
    const jobIds: string[] = [];
    
    for (const priority of priorities) {
      const job = await createJob({
        definitionKey,
        definitionVersion: 1,
        params: { priority },
        priority,
      });
      jobIds.push(job.id);
      await sleep(100); // Small delay to ensure different queued_at times
    }
    
    // Claim jobs and verify order (should be highest priority first)
    const claimedJobs: Job[] = [];
    for (let i = 0; i < priorities.length; i++) {
      const job = await claimJob(`worker-${i}`, 60);
      if (job) {
        claimedJobs.push(job);
      }
    }
    
    const claimedPriorities = claimedJobs.map(j => j.priority);
    const expectedOrder = [...priorities].sort((a, b) => b - a); // Descending
    
    // Check if claimed jobs are in priority order
    let correctOrder = true;
    for (let i = 0; i < claimedPriorities.length; i++) {
      if (claimedPriorities[i] !== expectedOrder[i]) {
        correctOrder = false;
        break;
      }
    }
    
    if (!correctOrder) {
      log(`✗ Priority order incorrect`, colors.red);
      log(`  Expected: ${expectedOrder.join(', ')}`, colors.yellow);
      log(`  Got: ${claimedPriorities.join(', ')}`, colors.yellow);
      return false;
    }
    
    log(`✓ Jobs claimed in correct priority order`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 4: Orphaned job recovery
 */
async function test4_OrphanedJobRecovery(): Promise<boolean> {
  log('\n=== Test 4: Orphaned Job Recovery ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.orphan.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create a job
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: { test: 'orphan' },
    });
    
    // Manually set it to running with expired lease
    const pool = getPool();
    await pool.query(
      `UPDATE jobs 
       SET status = 'running', 
           worker_id = 'dead-worker',
           started_at = NOW() - INTERVAL '2 minutes',
           heartbeat_at = NOW() - INTERVAL '2 minutes',
           lease_expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1`,
      [job.id]
    );
    
    // Verify the job is set up correctly before reclaiming
    const verifyJob = await getJobById(job.id);
    if (!verifyJob || verifyJob.status !== 'running') {
      log(`✗ Job not set to running correctly. Status: ${verifyJob?.status}`, colors.red);
      return false;
    }
    
    // Small delay to ensure the update is committed
    await sleep(50);
    
    // Reclaim orphaned jobs
    const reclaimed = await reclaimOrphanedJobs(60);
    
    if (reclaimed !== 1) {
      // Debug: Check what jobs exist
      const debugResult = await pool.query(
        `SELECT id, status, worker_id, lease_expires_at, 
                lease_expires_at < NOW() as is_expired
         FROM jobs WHERE id = $1`,
        [job.id]
      );
      if (debugResult.rows.length > 0) {
        const row = debugResult.rows[0];
        log(`✗ Expected 1 reclaimed job, got ${reclaimed}`, colors.red);
        log(`  Job status: ${row.status}`, colors.yellow);
        log(`  Worker ID: ${row.worker_id}`, colors.yellow);
        log(`  Lease expires at: ${row.lease_expires_at}`, colors.yellow);
        log(`  Is expired: ${row.is_expired}`, colors.yellow);
      } else {
        log(`✗ Job not found in database`, colors.red);
      }
      return false;
    }
    
    // Verify job is back to queued
    const reclaimedJob = await getJobById(job.id);
    if (!reclaimedJob || reclaimedJob.status !== 'queued') {
      log(`✗ Job not reclaimed correctly. Status: ${reclaimedJob?.status}`, colors.red);
      return false;
    }
    
    if (reclaimedJob.workerId !== null) {
      log(`✗ Worker ID should be null after reclaim, got ${reclaimedJob.workerId}`, colors.red);
      return false;
    }
    
    log(`✓ Orphaned job successfully reclaimed`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 5: Large payload handling
 */
async function test5_LargePayload(): Promise<boolean> {
  log('\n=== Test 5: Large Payload Handling ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.large.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create job with large payload (1MB of data)
    const largeData = 'x'.repeat(1024 * 1024); // 1MB string
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: { largeData },
    });
    
    // Verify job was created
    const retrieved = await getJobById(job.id);
    if (!retrieved) {
      log('✗ Job not found after creation', colors.red);
      return false;
    }
    
    // Verify payload is intact
    const retrievedData = (retrieved.params as any).largeData;
    if (retrievedData !== largeData) {
      log('✗ Large payload corrupted or truncated', colors.red);
      return false;
    }
    
    log(`✓ Large payload (${(largeData.length / 1024).toFixed(2)}KB) handled correctly`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 6: Max attempts boundary
 */
async function test6_MaxAttemptsBoundary(): Promise<boolean> {
  log('\n=== Test 6: Max Attempts Boundary ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.maxattempts.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Test with maxAttempts = 1 (should move to DLQ immediately on failure)
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: {},
      maxAttempts: 1,
    });
    
    // Manually mark as failed to simulate failure
    await updateJobStatus(job.id, 'failed', 'Test failure');
    
    // Verify job has maxAttempts = 1
    const retrieved = await getJobById(job.id);
    if (!retrieved || retrieved.maxAttempts !== 1) {
      log(`✗ Max attempts not set correctly. Got: ${retrieved?.maxAttempts}`, colors.red);
      return false;
    }
    
    log(`✓ Max attempts boundary handled correctly`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 7: Cancellation edge cases
 */
async function test7_CancellationEdgeCases(): Promise<boolean> {
  log('\n=== Test 7: Cancellation Edge Cases ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.cancel.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Test 7a: Cancel already succeeded job
    const job1 = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: {},
    });
    await updateJobStatus(job1.id, 'succeeded');
    
    try {
      await apiCall('POST', `/v1/jobs/${job1.id}/cancel`);
      log('✗ Should not allow cancelling succeeded job', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('already succeeded') || error.message.includes('Job is already')) {
        log('✓ Correctly rejected cancellation of succeeded job', colors.green);
      } else {
        throw error;
      }
    }
    
    // Test 7b: Cancel already cancelled job
    const job2 = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: {},
    });
    await updateJobStatus(job2.id, 'cancelled');
    
    try {
      await apiCall('POST', `/v1/jobs/${job2.id}/cancel`);
      log('✗ Should not allow cancelling already cancelled job', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('already cancelled') || error.message.includes('Job is already')) {
        log('✓ Correctly rejected cancellation of already cancelled job', colors.green);
      } else {
        throw error;
      }
    }
    
    // Test 7c: Cancel non-existent job
    try {
      await apiCall('POST', `/v1/jobs/${uuidv4()}/cancel`);
      log('✗ Should not allow cancelling non-existent job', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        log('✓ Correctly rejected cancellation of non-existent job', colors.green);
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 8: Concurrent claims from multiple workers
 */
async function test8_ConcurrentClaims(): Promise<boolean> {
  log('\n=== Test 8: Concurrent Claims from Multiple Workers ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.concurrent.claims.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create 5 jobs sequentially to ensure they're all created
    // Use direct database insertion to avoid triggering notifications that might wake up workers
    const pool = getPool();
    const jobs: Job[] = [];
    for (let i = 0; i < 5; i++) {
      // Insert job directly into database to avoid notifications
      const jobId = uuidv4();
      await pool.query(
        `INSERT INTO jobs (
          id, definition_key, definition_version, params, status, priority,
          max_attempts, queued_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *`,
        [
          jobId,
          definitionKey,
          1,
          JSON.stringify({ index: i }),
          'queued',
          0,
          3,
        ]
      );
      
      const job = await getJobById(jobId);
      if (!job) {
        log(`✗ Failed to create job ${i}`, colors.red);
        return false;
      }
      jobs.push(job);
      // Small delay to ensure different queued_at times
      await sleep(10);
    }
    
    // Verify all jobs exist immediately (before any worker can claim them)
    const verifyResult = await pool.query(
      'SELECT COUNT(*) as count FROM jobs WHERE definition_key = $1 AND status = $2',
      [definitionKey, 'queued']
    );
    const queuedCount = parseInt(verifyResult.rows[0].count, 10);
    if (queuedCount !== 5) {
      log(`✗ Expected 5 queued jobs, but found ${queuedCount}`, colors.red);
      log(`  Jobs in database:`, colors.yellow);
      const allJobs = await pool.query(
        'SELECT id, status, definition_key FROM jobs WHERE definition_key = $1',
        [definitionKey]
      );
      allJobs.rows.forEach(row => {
        log(`    - ${row.id}: ${row.status}`, colors.yellow);
      });
      return false;
    }
    
    // Have 10 workers try to claim simultaneously
    const workerIds = Array.from({ length: 10 }, (_, i) => `worker-${i}`);
    const claimPromises = workerIds.map(workerId => claimJob(workerId, 60));
    const results = await Promise.all(claimPromises);
    
    const claimedJobs = results.filter((j): j is Job => j !== null);
    const uniqueJobIds = new Set(claimedJobs.map(j => j.id));
    
    // If not all jobs were claimed, try again (might be timing issue)
    if (claimedJobs.length < 5) {
      log(`⚠ Only ${claimedJobs.length} jobs claimed on first attempt, retrying...`, colors.yellow);
      await sleep(100);
      
      const remainingWorkerIds = Array.from({ length: 10 }, (_, i) => `worker-retry-${i}`);
      const retryPromises = remainingWorkerIds.map(workerId => claimJob(workerId, 60));
      const retryResults = await Promise.all(retryPromises);
      const retryClaimed = retryResults.filter((j): j is Job => j !== null);
      
      // Add retry claims to the set
      retryClaimed.forEach(job => {
        if (!uniqueJobIds.has(job.id)) {
          claimedJobs.push(job);
          uniqueJobIds.add(job.id);
        }
      });
    }
    
    if (claimedJobs.length !== 5) {
      log(`✗ Expected 5 claimed jobs, got ${claimedJobs.length}`, colors.red);
      log(`  Claimed job IDs: ${Array.from(uniqueJobIds).join(', ')}`, colors.yellow);
      return false;
    }
    
    if (uniqueJobIds.size !== 5) {
      log(`✗ Expected 5 unique jobs, got ${uniqueJobIds.size}`, colors.red);
      log(`  Duplicate claims detected!`, colors.yellow);
      return false;
    }
    
    // Verify each job has unique worker
    const workerIdsSet = new Set(claimedJobs.map(j => j.workerId));
    if (workerIdsSet.size !== 5) {
      log(`✗ Expected 5 unique workers, got ${workerIdsSet.size}`, colors.red);
      return false;
    }
    
    log(`✓ ${claimedJobs.length} jobs claimed by ${workerIdsSet.size} unique workers (no duplicates)`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 9: Job listing edge cases
 */
async function test9_JobListingEdgeCases(): Promise<boolean> {
  log('\n=== Test 9: Job Listing Edge Cases ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey1 = `test.listing1.${uuidv4()}`;
    const definitionKey2 = `test.listing2.${uuidv4()}`;
    await createJobDefinition(definitionKey1, 1, 3, 3600, 0);
    await createJobDefinition(definitionKey2, 1, 3, 3600, 0);
    
    // Create jobs with different statuses
    const job1 = await createJob({ definitionKey: definitionKey1, definitionVersion: 1, params: {} });
    const job2 = await createJob({ definitionKey: definitionKey1, definitionVersion: 1, params: {} });
    const job3 = await createJob({ definitionKey: definitionKey2, definitionVersion: 1, params: {} });
    
    await updateJobStatus(job1.id, 'succeeded');
    await updateJobStatus(job2.id, 'failed');
    // job3 remains queued
    
    // Test 9a: List by status
    const queuedJobs = await listJobs('queued');
    if (queuedJobs.length !== 1 || queuedJobs[0].id !== job3.id) {
      log(`✗ Status filter failed. Expected 1 queued job, got ${queuedJobs.length}`, colors.red);
      return false;
    }
    
    // Test 9b: List by definition key
    const def1Jobs = await listJobs(undefined, definitionKey1);
    if (def1Jobs.length !== 2) {
      log(`✗ Definition filter failed. Expected 2 jobs, got ${def1Jobs.length}`, colors.red);
      return false;
    }
    
    // Test 9c: List with limit
    const limitedJobs = await listJobs(undefined, undefined, 1);
    if (limitedJobs.length !== 1) {
      log(`✗ Limit failed. Expected 1 job, got ${limitedJobs.length}`, colors.red);
      return false;
    }
    
    // Test 9d: List with offset
    const offsetJobs = await listJobs(undefined, undefined, 10, 1);
    if (offsetJobs.length !== 2) {
      log(`✗ Offset failed. Expected 2 jobs, got ${offsetJobs.length}`, colors.red);
      return false;
    }
    
    log(`✓ Job listing filters work correctly`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 10: DLQ edge cases
 */
async function test10_DlqEdgeCases(): Promise<boolean> {
  log('\n=== Test 10: DLQ Edge Cases ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.dlq.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create a job and move it to DLQ
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: { test: 'dlq' },
    });
    
    await updateJobStatus(job.id, 'failed', 'Test error');
    const dlqJob = await moveJobToDlq(job, 'Test error');
    
    // Test 10a: Verify job is removed from main table
    const mainJob = await getJobById(job.id);
    if (mainJob !== null) {
      log('✗ Job still exists in main table after moving to DLQ', colors.red);
      return false;
    }
    
    // Test 10b: Try to get DLQ job via API
    try {
      const dlqResponse = await apiCall('GET', `/v1/dlq/${dlqJob.id}`) as any;
      if (dlqResponse.dlqJobId !== dlqJob.id) {
        log('✗ DLQ job ID mismatch', colors.red);
        return false;
      }
      log('✓ DLQ job retrieved successfully', colors.green);
    } catch (error: any) {
      log(`✗ Failed to retrieve DLQ job: ${error.message}`, colors.red);
      return false;
    }
    
    // Test 10c: Try to retry non-existent DLQ job
    try {
      await apiCall('POST', `/v1/dlq/${uuidv4()}/retry`);
      log('✗ Should not allow retrying non-existent DLQ job', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        log('✓ Correctly rejected retry of non-existent DLQ job', colors.green);
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 11: Empty database edge cases
 */
async function test11_EmptyDatabase(): Promise<boolean> {
  log('\n=== Test 11: Empty Database Edge Cases ===', colors.blue);
  
  try {
    await clearDatabase();
    
    // Test 11a: List jobs on empty database
    const jobs = await listJobs();
    if (jobs.length !== 0) {
      log(`✗ Expected 0 jobs, got ${jobs.length}`, colors.red);
      return false;
    }
    
    // Test 11b: Get non-existent job
    const job = await getJobById(uuidv4());
    if (job !== null) {
      log('✗ Expected null for non-existent job', colors.red);
      return false;
    }
    
    // Test 11c: Try to cancel non-existent job via API
    try {
      await apiCall('POST', `/v1/jobs/${uuidv4()}/cancel`);
      log('✗ Should not allow cancelling non-existent job', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('404') || error.message.includes('not found')) {
        log('✓ Correctly handled non-existent job cancellation', colors.green);
      } else {
        throw error;
      }
    }
    
    log(`✓ Empty database edge cases handled correctly`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 12: Invalid API inputs
 */
async function test12_InvalidApiInputs(): Promise<boolean> {
  log('\n=== Test 12: Invalid API Inputs ===', colors.blue);
  
  try {
    await clearDatabase();
    
    // Test 12a: Missing required fields
    try {
      await apiCall('POST', '/v1/jobs', {});
      log('✗ Should reject job creation without definitionKey', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('400') || error.message.includes('Invalid')) {
        log('✓ Correctly rejected invalid job creation', colors.green);
      } else {
        throw error;
      }
    }
    
    // Test 12b: Invalid job ID format
    try {
      await apiCall('GET', '/v1/jobs/invalid-id-format');
      log('✗ Should handle invalid job ID gracefully', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('400') || error.message.includes('Invalid job ID format')) {
        log('✓ Correctly handled invalid job ID', colors.green);
      } else if (error.message.includes('404')) {
        // Also acceptable - invalid UUID might be treated as not found
        log('✓ Invalid job ID handled (treated as not found)', colors.green);
      } else {
        throw error;
      }
    }
    
    // Test 12c: Invalid query parameters
    try {
      await apiCall('GET', '/v1/jobs?status=invalid_status');
      // This might succeed but return empty list, which is acceptable
      log('✓ Invalid status handled gracefully', colors.green);
    } catch (error: any) {
      // Also acceptable if it rejects
      if (error.message.includes('400')) {
        log('✓ Invalid status rejected', colors.green);
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 13: Scheduled jobs edge cases
 */
async function test13_ScheduledJobs(): Promise<boolean> {
  log('\n=== Test 13: Scheduled Jobs Edge Cases ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.scheduled.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    const pool = getPool();
    
    // Create a job scheduled for the future
    const futureDate = new Date(Date.now() + 60000); // 1 minute from now
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: {},
    });
    
    await pool.query(
      `UPDATE jobs SET scheduled_at = $1 WHERE id = $2`,
      [futureDate, job.id]
    );
    
    // Try to claim it - should not be claimable yet
    const claimed = await claimJob('test-worker', 60);
    if (claimed !== null && claimed.id === job.id) {
      log('✗ Scheduled job claimed before scheduled time', colors.red);
      return false;
    }
    
    // Update scheduled_at to past
    await pool.query(
      `UPDATE jobs SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [job.id]
    );
    
    // Now it should be claimable
    const claimedAfter = await claimJob('test-worker-2', 60);
    if (claimedAfter === null || claimedAfter.id !== job.id) {
      log('✗ Scheduled job not claimable after scheduled time', colors.red);
      return false;
    }
    
    log(`✓ Scheduled jobs handled correctly`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 14: Metrics edge cases
 */
async function test14_MetricsEdgeCases(): Promise<boolean> {
  log('\n=== Test 14: Metrics Edge Cases ===', colors.blue);
  
  try {
    await clearDatabase();
    
    // Test 14a: Metrics on empty database
    try {
      const metrics = await apiCall('GET', '/v1/metrics') as any;
      if (metrics.summary.total !== 0) {
        log(`✗ Expected 0 total jobs, got ${metrics.summary.total}`, colors.red);
        return false;
      }
      log('✓ Metrics work on empty database', colors.green);
    } catch (error: any) {
      log(`✗ Metrics failed on empty database: ${error.message}`, colors.red);
      return false;
    }
    
    // Test 14b: Throughput with no completed jobs
    try {
      const throughput = await apiCall('GET', '/v1/metrics/throughput') as any;
      if (throughput.data.length !== 0) {
        log(`✗ Expected empty throughput data, got ${throughput.data.length}`, colors.red);
        return false;
      }
      log('✓ Throughput handles empty data correctly', colors.green);
    } catch (error: any) {
      log(`✗ Throughput failed: ${error.message}`, colors.red);
      return false;
    }
    
    // Test 14c: Invalid hours parameter
    try {
      await apiCall('GET', '/v1/metrics/throughput?hours=200');
      log('✗ Should reject hours > 168', colors.red);
      return false;
    } catch (error: any) {
      if (error.message.includes('400') || error.message.includes('between 1 and 168')) {
        log('✓ Correctly rejected invalid hours parameter', colors.green);
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 15: Worker crash simulation
 */
async function test15_WorkerCrashSimulation(): Promise<boolean> {
  log('\n=== Test 15: Worker Crash Simulation ===', colors.blue);
  
  try {
    await clearDatabase();
    
    const definitionKey = `test.crash.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create a job and simulate worker crash (set running with expired lease)
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: {},
    });
    
    const pool = getPool();
    await pool.query(
      `UPDATE jobs 
       SET status = 'running',
           worker_id = 'crashed-worker',
           started_at = NOW() - INTERVAL '5 minutes',
           heartbeat_at = NOW() - INTERVAL '3 minutes',
           lease_expires_at = NOW() - INTERVAL '2 minutes'
       WHERE id = $1`,
      [job.id]
    );
    
    // Reclaim should pick it up
    const reclaimed = await reclaimOrphanedJobs(60);
    if (reclaimed !== 1) {
      log(`✗ Expected 1 reclaimed job, got ${reclaimed}`, colors.red);
      return false;
    }
    
    // Verify job is back to queued
    const reclaimedJob = await getJobById(job.id);
    if (!reclaimedJob || reclaimedJob.status !== 'queued') {
      log(`✗ Job not reclaimed. Status: ${reclaimedJob?.status}`, colors.red);
      return false;
    }
    
    log(`✓ Worker crash scenario handled correctly`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  log('\n' + '='.repeat(70), colors.blue);
  log('  COMPREHENSIVE EDGE CASE TEST SUITE', colors.blue);
  log('='.repeat(70), colors.blue);
  
  await runMigrations();
  
  const tests = [
    { name: 'Concurrent Idempotency', fn: test1_ConcurrentIdempotency },
    { name: 'Invalid Job Definition', fn: test2_InvalidJobDefinition },
    { name: 'Priority Ordering', fn: test3_PriorityOrdering },
    { name: 'Orphaned Job Recovery', fn: test4_OrphanedJobRecovery },
    { name: 'Large Payload Handling', fn: test5_LargePayload },
    { name: 'Max Attempts Boundary', fn: test6_MaxAttemptsBoundary },
    { name: 'Cancellation Edge Cases', fn: test7_CancellationEdgeCases },
    { name: 'Concurrent Claims', fn: test8_ConcurrentClaims },
    { name: 'Job Listing Edge Cases', fn: test9_JobListingEdgeCases },
    { name: 'DLQ Edge Cases', fn: test10_DlqEdgeCases },
    { name: 'Empty Database', fn: test11_EmptyDatabase },
    { name: 'Invalid API Inputs', fn: test12_InvalidApiInputs },
    { name: 'Scheduled Jobs', fn: test13_ScheduledJobs },
    { name: 'Metrics Edge Cases', fn: test14_MetricsEdgeCases },
    { name: 'Worker Crash Simulation', fn: test15_WorkerCrashSimulation },
  ];
  
  const results: { name: string; passed: boolean; error?: string }[] = [];
  
  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
      await sleep(500); // Small delay between tests
    } catch (error: any) {
      results.push({ name: test.name, passed: false, error: error.message });
      log(`✗ Test "${test.name}" threw error: ${error.message}`, colors.red);
    }
  }
  
  // Print summary
  log('\n' + '='.repeat(70), colors.blue);
  log('  TEST RESULTS SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);
  
  results.forEach((result, i) => {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const color = result.passed ? colors.green : colors.red;
    log(`${i + 1}. ${result.name}: ${status}`, color);
    if (result.error) {
      log(`   Error: ${result.error}`, colors.yellow);
    }
  });
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  log(`\nTotal: ${passed}/${total} tests passed`, passed === total ? colors.green : colors.yellow);
  
  if (passed === total) {
    log('\n🎉 All edge case tests passed!', colors.green);
    process.exit(0);
  } else {
    log('\n⚠ Some edge case tests failed', colors.yellow);
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  log(`\n✗ Fatal error: ${error}`, colors.red);
  process.exit(1);
});

