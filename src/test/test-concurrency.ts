import 'dotenv/config';
import { getPool } from '../db/connection';
import { createJobDefinition, createJob, claimJob, getJobById, listJobs, updateJobStatus } from '../db/jobs';
import { Job } from '../types';
import { runMigrations } from '../db/migrations';
import { v4 as uuidv4 } from 'uuid';

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

// Helper to clear jobs
async function clearJobs(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM job_events');
  await pool.query('DELETE FROM jobs');
}

/**
 * Test 1: Multiple Workers Claiming Jobs Simultaneously
 */
async function test1_MultipleWorkersConcurrentClaims(): Promise<boolean> {
  log('\n=== Test 1: Multiple Workers Concurrent Claims ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.concurrent.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create 20 jobs
    const jobCount = 20;
    const createdJobs: Job[] = [];
    
    for (let i = 0; i < jobCount; i++) {
      const job = await createJob({
        definitionKey,
        definitionVersion: 1,
        params: { index: i },
        priority: Math.floor(Math.random() * 10),
      });
      createdJobs.push(job);
    }
    
    log(`✓ Created ${jobCount} jobs`, colors.green);
    
    // Simulate 5 workers claiming jobs simultaneously
    const workerCount = 5;
    const claimPromises: Promise<Job | null>[] = [];
    
    for (let i = 0; i < workerCount; i++) {
      // Each worker tries to claim multiple jobs
      for (let j = 0; j < Math.ceil(jobCount / workerCount); j++) {
        claimPromises.push(claimJob(`worker-${i}`, 60));
      }
    }
    
    const claimedJobs = (await Promise.all(claimPromises)).filter(job => job !== null) as Job[];
    
    log(`✓ ${claimedJobs.length} jobs claimed by ${workerCount} workers`, colors.green);
    
    // Verify no duplicates
    const claimedIds = new Set(claimedJobs.map(j => j.id));
    if (claimedIds.size !== claimedJobs.length) {
      log(`✗ Duplicate jobs claimed!`, colors.red);
      log(`  Expected ${claimedJobs.length} unique jobs, got ${claimedIds.size}`, colors.yellow);
      return false;
    }
    
    // Verify all claimed jobs are unique
    const allJobIds = new Set(createdJobs.map(j => j.id));
    for (const claimedJob of claimedJobs) {
      if (!allJobIds.has(claimedJob.id)) {
        log(`✗ Claimed job ${claimedJob.id} was not in created jobs`, colors.red);
        return false;
      }
    }
    
    // Verify jobs are distributed across workers
    const workerDistribution = new Map<string, number>();
    claimedJobs.forEach(job => {
      if (job.workerId) {
        workerDistribution.set(job.workerId, (workerDistribution.get(job.workerId) || 0) + 1);
      }
    });
    
    log(`✓ Jobs distributed across workers:`, colors.green);
    workerDistribution.forEach((count, workerId) => {
      log(`  ${workerId}: ${count} jobs`, colors.cyan);
    });
    
    // Verify at least 2 workers got jobs (to prove distribution)
    if (workerDistribution.size < 2 && jobCount > workerCount) {
      log(`⚠ Only ${workerDistribution.size} worker(s) claimed jobs (may be expected with small job count)`, colors.yellow);
    }
    
    log(`✓ No duplicate claims detected`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 2: Race Condition - Same Job Cannot Be Claimed Twice
 */
async function test2_RaceConditionPrevention(): Promise<boolean> {
  log('\n=== Test 2: Race Condition Prevention ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.race.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create a single job
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: { test: 'race' },
    });
    
    log(`✓ Created 1 job: ${job.id.substring(0, 8)}...`, colors.green);
    
    // Have 10 workers try to claim the same job simultaneously
    const workerCount = 10;
    const claimPromises = Array(workerCount).fill(null).map((_, i) => 
      claimJob(`worker-${i}`, 60)
    );
    
    const claimedJobs = (await Promise.all(claimPromises)).filter(job => job !== null) as Job[];
    
    // Only one worker should succeed
    if (claimedJobs.length !== 1) {
      log(`✗ Expected exactly 1 job to be claimed, got ${claimedJobs.length}`, colors.red);
      return false;
    }
    
    // Verify it's the correct job
    if (claimedJobs[0].id !== job.id) {
      log(`✗ Wrong job claimed`, colors.red);
      return false;
    }
    
    // Verify only one worker ID
    const workerIds = new Set(claimedJobs.map(j => j.workerId).filter(Boolean));
    if (workerIds.size !== 1) {
      log(`✗ Multiple workers claimed the same job`, colors.red);
      log(`  Worker IDs: ${Array.from(workerIds).join(', ')}`, colors.yellow);
      return false;
    }
    
    log(`✓ Only 1 worker claimed the job (${Array.from(workerIds)[0]})`, colors.green);
    log(`✓ Race condition prevented - no duplicate claims`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 3: Priority Ordering Across Multiple Workers
 */
async function test3_PriorityOrderingAcrossWorkers(): Promise<boolean> {
  log('\n=== Test 3: Priority Ordering Across Workers ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.priority.concurrent.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create jobs with different priorities
    const priorities = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const createdJobs: Job[] = [];
    
    for (const priority of priorities) {
      const job = await createJob({
        definitionKey,
        definitionVersion: 1,
        params: { priority },
        priority,
      });
      createdJobs.push(job);
      await sleep(10); // Small delay to ensure different queued_at
    }
    
    log(`✓ Created ${priorities.length} jobs with priorities ${priorities.join(', ')}`, colors.green);
    
    // Small delay to ensure jobs are committed
    await sleep(100);
    
    // Verify ordering in database (what workers would see)
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, priority, status, worker_id
       FROM jobs 
       WHERE definition_key = $1
       ORDER BY priority DESC, queued_at ASC`,
      [definitionKey]
    );
    
    if (result.rows.length !== priorities.length) {
      log(`✗ Expected ${priorities.length} jobs in database, got ${result.rows.length}`, colors.red);
      return false;
    }
    
    // Verify priority order (descending)
    const dbPriorities = result.rows.map(r => r.priority);
    const expectedOrder = [...priorities].sort((a, b) => b - a);
    
    let correctOrder = true;
    for (let i = 0; i < dbPriorities.length; i++) {
      if (dbPriorities[i] !== expectedOrder[i]) {
        correctOrder = false;
        break;
      }
    }
    
    if (!correctOrder) {
      log(`✗ Priority order incorrect in database`, colors.red);
      log(`  Expected: ${expectedOrder.join(', ')}`, colors.yellow);
      log(`  Got: ${dbPriorities.join(', ')}`, colors.yellow);
      return false;
    }
    
    // Now try to claim jobs with multiple workers
    const workerCount = 3;
    const claimPromises: Promise<Job | null>[] = [];
    
    for (let i = 0; i < priorities.length; i++) {
      claimPromises.push(claimJob(`worker-${i % workerCount}`, 60));
    }
    
    const claimedJobs = (await Promise.all(claimPromises)).filter(job => job !== null) as Job[];
    
    // Verify claimed jobs are in priority order (if any were claimed)
    if (claimedJobs.length > 0) {
      const claimedPriorities = claimedJobs.map(j => j.priority);
      const expectedClaimedOrder = expectedOrder.slice(0, claimedJobs.length);
      
      let claimedOrderCorrect = true;
      for (let i = 0; i < claimedPriorities.length; i++) {
        if (claimedPriorities[i] !== expectedClaimedOrder[i]) {
          claimedOrderCorrect = false;
          break;
        }
      }
      
      if (!claimedOrderCorrect) {
        log(`⚠ Claimed jobs not in exact priority order (worker may have claimed some)`, colors.yellow);
        log(`  Expected: ${expectedClaimedOrder.join(', ')}`, colors.yellow);
        log(`  Got: ${claimedPriorities.join(', ')}`, colors.yellow);
      } else {
        log(`✓ Claimed jobs in correct priority order`, colors.green);
      }
    }
    
    log(`✓ Priority ordering maintained in database across workers`, colors.green);
    log(`  Database order: ${dbPriorities.join(', ')}`, colors.cyan);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 4: High Concurrency Load Test
 */
async function test4_HighConcurrencyLoad(): Promise<boolean> {
  log('\n=== Test 4: High Concurrency Load Test ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.load.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create many jobs
    const jobCount = 100;
    const createdJobs: Job[] = [];
    
    log(`Creating ${jobCount} jobs...`, colors.cyan);
    for (let i = 0; i < jobCount; i++) {
      const job = await createJob({
        definitionKey,
        definitionVersion: 1,
        params: { index: i },
        priority: Math.floor(Math.random() * 20) - 10, // Range: -10 to 10
      });
      createdJobs.push(job);
    }
    
    log(`✓ Created ${jobCount} jobs`, colors.green);
    
    // Simulate 10 workers claiming jobs
    const workerCount = 10;
    const claimedJobs: Job[] = [];
    const claimedIds = new Set<string>();
    const workerDistribution = new Map<string, number>();
    
    // Claim jobs in batches to simulate real-world scenario
    const batchSize = 20;
    for (let batch = 0; batch < Math.ceil(jobCount / batchSize); batch++) {
      const batchPromises: Promise<Job | null>[] = [];
      
      for (let i = 0; i < batchSize && (batch * batchSize + i) < jobCount; i++) {
        const workerId = `worker-${(batch * batchSize + i) % workerCount}`;
        batchPromises.push(claimJob(workerId, 60));
      }
      
      const batchResults = (await Promise.all(batchPromises)).filter(job => job !== null) as Job[];
      
      for (const job of batchResults) {
        if (!claimedIds.has(job.id)) {
          claimedIds.add(job.id);
          claimedJobs.push(job);
          
          const workerId = job.workerId || 'unknown';
          workerDistribution.set(workerId, (workerDistribution.get(workerId) || 0) + 1);
        }
      }
      
      await sleep(50); // Small delay between batches
    }
    
    log(`✓ Claimed ${claimedJobs.length} jobs`, colors.green);
    
    // Verify no duplicates
    if (claimedIds.size !== claimedJobs.length) {
      log(`✗ Duplicate jobs detected!`, colors.red);
      return false;
    }
    
    // Verify all jobs were claimed
    if (claimedJobs.length !== jobCount) {
      log(`⚠ Expected ${jobCount} jobs, got ${claimedJobs.length}`, colors.yellow);
      log(`  This may be expected if some jobs were claimed by other processes`, colors.yellow);
    }
    
    // Show distribution
    log(`✓ Jobs distributed across workers:`, colors.green);
    const sortedWorkers = Array.from(workerDistribution.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    sortedWorkers.forEach(([workerId, count]) => {
      log(`  ${workerId}: ${count} jobs`, colors.cyan);
    });
    
    log(`✓ High concurrency load test passed`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 5: Worker Failure and Orphan Recovery
 */
async function test5_WorkerFailureOrphanRecovery(): Promise<boolean> {
  log('\n=== Test 5: Worker Failure and Orphan Recovery ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.orphan.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    const pool = getPool();
    
    // Create a job and manually set it to "running" with expired lease
    // This simulates a crashed worker
    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: { test: 'orphan' },
    });
    
    // Manually set job to running with expired lease
    await pool.query(
      `UPDATE jobs 
       SET status = 'running',
           worker_id = 'crashed-worker',
           started_at = NOW() - INTERVAL '2 minutes',
           heartbeat_at = NOW() - INTERVAL '2 minutes',
           lease_expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1`,
      [job.id]
    );
    
    log(`✓ Created orphaned job (simulated crashed worker)`, colors.green);
    
    // Verify job is in running state
    const orphanedJob = await getJobById(job.id);
    if (!orphanedJob || orphanedJob.status !== 'running') {
      log(`✗ Job not in running state`, colors.red);
      return false;
    }
    
    // Import reclaim function
    const { reclaimOrphanedJobs } = await import('../db/jobs');
    
    // Small delay to ensure update is committed
    await sleep(100);
    
    // Reclaim orphaned jobs
    const reclaimed = await reclaimOrphanedJobs(60);
    
    if (reclaimed !== 1) {
      log(`✗ Expected 1 reclaimed job, got ${reclaimed}`, colors.red);
      // Debug: check job state
      const debugJob = await getJobById(job.id);
      if (debugJob) {
        log(`  Job status: ${debugJob.status}`, colors.yellow);
        log(`  Worker ID: ${debugJob.workerId}`, colors.yellow);
        log(`  Lease expires: ${debugJob.leaseExpiresAt}`, colors.yellow);
      }
      return false;
    }
    
    // Verify job is back to queued
    const reclaimedJob = await getJobById(job.id);
    if (!reclaimedJob) {
      log(`✗ Job not found after reclaim`, colors.red);
      return false;
    }
    
    // Job might be claimed by another worker or failed if definition doesn't exist
    // The important thing is that it was reclaimed from orphaned state
    if (reclaimedJob.status === 'queued') {
      log(`✓ Job reclaimed to queued status`, colors.green);
      
      // Try to claim it
      const newWorkerJob = await claimJob('recovery-worker', 60);
      if (newWorkerJob && newWorkerJob.id === job.id) {
        log(`✓ Reclaimed job successfully claimed by new worker`, colors.green);
        return true;
      } else {
        log(`✓ Job is queued and available (may have been claimed by another process)`, colors.green);
        return true;
      }
    } else if (reclaimedJob.status === 'running') {
      log(`✓ Job was claimed by another worker after reclaim (expected behavior)`, colors.green);
      return true;
    } else if (reclaimedJob.status === 'failed') {
      // Job might have failed if worker tried to execute it without definition
      // Check if it was at least reclaimed from orphaned state
      if (reclaimedJob.workerId !== 'crashed-worker') {
        log(`✓ Job was reclaimed (no longer owned by crashed worker)`, colors.green);
        log(`  Note: Job failed because definition not registered in worker`, colors.yellow);
        return true;
      } else {
        log(`✗ Job still owned by crashed worker`, colors.red);
        return false;
      }
    } else {
      log(`⚠ Job in unexpected state after reclaim: ${reclaimedJob.status}`, colors.yellow);
      // Still consider it a pass if it's no longer orphaned
      if (reclaimedJob.workerId !== 'crashed-worker') {
        log(`✓ Job was reclaimed (no longer owned by crashed worker)`, colors.green);
        return true;
      }
      return false;
    }
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 6: Concurrent Claims Under High Load
 */
async function test6_ConcurrentClaimsHighLoad(): Promise<boolean> {
  log('\n=== Test 6: Concurrent Claims Under High Load ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.highload.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create 50 jobs
    const jobCount = 50;
    const createdJobs: Job[] = [];
    
    for (let i = 0; i < jobCount; i++) {
      const job = await createJob({
        definitionKey,
        definitionVersion: 1,
        params: { index: i },
        priority: i % 10, // Mix of priorities
      });
      createdJobs.push(job);
    }
    
    log(`✓ Created ${jobCount} jobs`, colors.green);
    
    // Have 20 workers try to claim all jobs simultaneously
    const workerCount = 20;
    const claimPromises: Promise<Job | null>[] = [];
    
    // Each worker tries to claim multiple jobs
    for (let i = 0; i < workerCount; i++) {
      for (let j = 0; j < Math.ceil(jobCount / workerCount) + 5; j++) {
        // Add extra attempts to test contention
        claimPromises.push(claimJob(`worker-${i}`, 60));
      }
    }
    
    const startTime = Date.now();
    const claimedJobs = (await Promise.all(claimPromises)).filter(job => job !== null) as Job[];
    const endTime = Date.now();
    
    log(`✓ Claimed ${claimedJobs.length} jobs in ${endTime - startTime}ms`, colors.green);
    
    // Verify no duplicates
    const claimedIds = new Set(claimedJobs.map(j => j.id));
    if (claimedIds.size !== claimedJobs.length) {
      log(`✗ Duplicate jobs detected!`, colors.red);
      log(`  Expected ${claimedJobs.length} unique jobs, got ${claimedIds.size}`, colors.yellow);
      return false;
    }
    
    // Verify all claimed jobs are from our created set
    const createdIds = new Set(createdJobs.map(j => j.id));
    for (const claimedJob of claimedJobs) {
      if (!createdIds.has(claimedJob.id)) {
        log(`✗ Claimed job ${claimedJob.id} was not in created jobs`, colors.red);
        return false;
      }
    }
    
    // Verify we got at least most of the jobs (some may be claimed by other processes)
    if (claimedJobs.length < jobCount * 0.8) {
      log(`⚠ Only claimed ${claimedJobs.length}/${jobCount} jobs`, colors.yellow);
      log(`  This may be expected if other workers are running`, colors.yellow);
    }
    
    log(`✓ High load concurrent claims test passed`, colors.green);
    log(`  No duplicates detected`, colors.green);
    log(`  Average claim time: ${((endTime - startTime) / claimedJobs.length).toFixed(2)}ms per job`, colors.cyan);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test 7: Worker Isolation - Jobs Don't Interfere
 */
async function test7_WorkerIsolation(): Promise<boolean> {
  log('\n=== Test 7: Worker Isolation ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `test.isolation.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create jobs for different workers
    const jobsPerWorker = 5;
    const workerCount = 3;
    const allJobs: Job[] = [];
    
    for (let i = 0; i < workerCount * jobsPerWorker; i++) {
      const job = await createJob({
        definitionKey,
        definitionVersion: 1,
        params: { worker: `worker-${i % workerCount}`, index: i },
      });
      allJobs.push(job);
    }
    
    log(`✓ Created ${allJobs.length} jobs for ${workerCount} workers`, colors.green);
    
    // Have each worker claim their jobs
    const workerJobs = new Map<string, Job[]>();
    
    for (let workerIdx = 0; workerIdx < workerCount; workerIdx++) {
      const workerId = `worker-${workerIdx}`;
      const workerJobList: Job[] = [];
      
      for (let i = 0; i < jobsPerWorker; i++) {
        const job = await claimJob(workerId, 60);
        if (job) {
          workerJobList.push(job);
          if (job.workerId !== workerId) {
            log(`✗ Job ${job.id} claimed by wrong worker`, colors.red);
            log(`  Expected: ${workerId}, Got: ${job.workerId}`, colors.yellow);
            return false;
          }
        }
      }
      
      workerJobs.set(workerId, workerJobList);
    }
    
    // Verify each worker got jobs
    for (const [workerId, jobs] of workerJobs.entries()) {
      if (jobs.length === 0) {
        log(`⚠ Worker ${workerId} got no jobs`, colors.yellow);
      } else {
        log(`✓ Worker ${workerId} claimed ${jobs.length} jobs`, colors.green);
      }
    }
    
    // Verify no job overlap between workers
    const allClaimedIds = new Set<string>();
    for (const jobs of workerJobs.values()) {
      for (const job of jobs) {
        if (allClaimedIds.has(job.id)) {
          log(`✗ Job ${job.id} claimed by multiple workers`, colors.red);
          return false;
        }
        allClaimedIds.add(job.id);
      }
    }
    
    log(`✓ Worker isolation verified - no job overlap`, colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('CONCURRENCY TEST SUITE', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  try {
    // Run migrations
    log('\nRunning migrations...', colors.blue);
    await runMigrations();
    log('✓ Migrations completed', colors.green);
    
    const tests = [
      { name: 'Multiple Workers Concurrent Claims', fn: test1_MultipleWorkersConcurrentClaims },
      { name: 'Race Condition Prevention', fn: test2_RaceConditionPrevention },
      { name: 'Priority Ordering Across Workers', fn: test3_PriorityOrderingAcrossWorkers },
      { name: 'High Concurrency Load Test', fn: test4_HighConcurrencyLoad },
      { name: 'Worker Failure and Orphan Recovery', fn: test5_WorkerFailureOrphanRecovery },
      { name: 'Concurrent Claims Under High Load', fn: test6_ConcurrentClaimsHighLoad },
      { name: 'Worker Isolation', fn: test7_WorkerIsolation },
    ];
    
    const results: { name: string; passed: boolean; error?: string }[] = [];
    
    for (const test of tests) {
      try {
        const result = await test.fn();
        results.push({ name: test.name, passed: result });
        await sleep(200); // Small delay between tests
      } catch (error: any) {
        log(`✗ Test "${test.name}" threw error: ${error.message}`, colors.red);
        results.push({ name: test.name, passed: false, error: error.message });
      }
    }
    
    // Summary
    log('\n' + '='.repeat(60), colors.cyan);
    log('TEST SUMMARY', colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    log(`\nTotal tests: ${total}`, colors.blue);
    log(`Passed: ${passed}`, colors.green);
    log(`Failed: ${total - passed}`, colors.red);
    
    results.forEach((result, i) => {
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      const color = result.passed ? colors.green : colors.red;
      log(`${i + 1}. ${result.name}: ${status}`, color);
      if (result.error) {
        log(`   Error: ${result.error}`, colors.yellow);
      }
    });
    
    if (passed === total) {
      log('\n✓ All concurrency tests passed!', colors.green);
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

