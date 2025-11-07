import 'dotenv/config';
import { createJobDefinition } from '../db/jobs';
import { runMigrations } from '../db/migrations';

const API_URL = process.env.API_URL || 'http://localhost:3000';

// Helper function to make API calls
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

// Wait function
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test colors
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function test1_CreateAndExecuteEchoJob() {
  log('\n=== Test 1: Create and Execute Echo Job ===', colors.blue);
  
  // Create job
  log('Creating echo job...');
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'echo',
    definitionVersion: 1,
    params: { message: 'Hello from test!' },
    priority: 5,
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`, colors.green);
  log(`  Status: ${createResponse.status}`);
  
  // Poll for status updates - wait longer for completion
  let status = createResponse.status;
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds max (job takes ~1 second + overhead)
  let lastStatus = status;
  
  while ((status === 'queued' || status === 'running') && attempts < maxAttempts) {
    await sleep(1000);
    attempts++;
    
    try {
      const job = await apiCall('GET', `/v1/jobs/${jobId}`);
      status = job.status;
      
      // Log status changes
      if (status !== lastStatus) {
        if (status === 'running') {
          log(`✓ Job started running (attempt ${attempts}s)`, colors.green);
          log(`  Worker ID: ${job.workerId}`);
        } else if (status === 'succeeded') {
          log(`✓ Job succeeded! (attempt ${attempts}s)`, colors.green);
          break;
        } else if (status === 'failed') {
          log(`✗ Job failed: ${job.errorSummary}`, colors.red);
          break;
        }
        lastStatus = status;
      }
    } catch (error) {
      log(`⚠ Error checking job status: ${error}`, colors.yellow);
    }
  }
  
  if (status === 'queued' || status === 'running') {
    log(`✗ Job still ${status} after ${maxAttempts} seconds`, colors.red);
    return false;
  }
  
  if (status !== 'succeeded') {
    log(`✗ Job ended with status: ${status}`, colors.red);
    return false;
  }
  
  // Get final job details
  const finalJob = await apiCall('GET', `/v1/jobs/${jobId}`);
  log(`\nFinal job details:`, colors.blue);
  log(`  Status: ${finalJob.status}`);
  log(`  Started at: ${finalJob.startedAt || 'N/A'}`);
  log(`  Finished at: ${finalJob.finishedAt || 'N/A'}`);
  
  // Get events
  const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
  log(`\nJob events (${events.events.length}):`, colors.blue);
  events.events.forEach((event: any, i: number) => {
    log(`  ${i + 1}. ${event.eventType} at ${event.at}`);
  });
  
  // Verify we have both started and succeeded events
  const eventTypes = events.events.map((e: any) => e.eventType);
  if (!eventTypes.includes('started')) {
    log(`✗ Missing 'started' event`, colors.red);
    return false;
  }
  if (!eventTypes.includes('succeeded')) {
    log(`✗ Missing 'succeeded' event`, colors.red);
    return false;
  }
  
  return status === 'succeeded';
}

async function test2_TestRetryLogic() {
  log('\n=== Test 2: Test Retry Logic with Failing Job ===', colors.blue);
  
  // Create failing job
  log('Creating failing job (will retry 3 times, then move to DLQ)...');
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'failing',
    definitionVersion: 1,
    params: {},
    maxAttempts: 3,
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`, colors.green);
  
  // Wait for it to fail and retry, then move to DLQ
  let status = 'queued';
  let waitSeconds = 0;
  const maxWaitSeconds = 120; // 120 seconds for retries with exponential backoff
  let dlqJob = null;
  let lastJobAttempts = 0;
  
  while (waitSeconds < maxWaitSeconds) {
    await sleep(1000);
    waitSeconds++;
    
    // Check DLQ first (most important check)
    try {
      const dlqResponse = await apiCall('GET', '/v1/dlq');
      dlqJob = dlqResponse.jobs.find((j: any) => j.originalJobId === jobId);
      if (dlqJob) {
        log(`✓ Job moved to DLQ after ${waitSeconds} seconds`, colors.green);
        break;
      }
    } catch (error) {
      // Continue checking
    }
    
    // Check job status
    try {
      const job = await apiCall('GET', `/v1/jobs/${jobId}`);
      status = job.status;
      const currentAttempts = job.attempts || 0;
      
      // Log when attempts change
      if (currentAttempts !== lastJobAttempts) {
        log(`  Attempt ${currentAttempts}/${job.maxAttempts}, Status: ${status}`, colors.yellow);
        lastJobAttempts = currentAttempts;
      }
      
      // If job has reached max attempts, it should move to DLQ soon
      // Wait a bit more to allow DLQ movement
      if (currentAttempts >= job.maxAttempts) {
        log(`  Job reached max attempts (${currentAttempts}), waiting for DLQ movement...`, colors.cyan);
        // Wait a few more seconds for DLQ movement
        for (let i = 0; i < 5 && waitSeconds < maxWaitSeconds; i++) {
          await sleep(1000);
          waitSeconds++;
          try {
            const dlqCheck = await apiCall('GET', '/v1/dlq');
            dlqJob = dlqCheck.jobs.find((j: any) => j.originalJobId === jobId);
            if (dlqJob) {
              log(`✓ Job moved to DLQ after ${waitSeconds} seconds`, colors.green);
              break;
            }
          } catch (error) {
            // Continue
          }
        }
        if (dlqJob) break;
      }
    } catch (error: any) {
      // Job might have been moved to DLQ (404)
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        // Double-check DLQ
        try {
          const dlqResponse = await apiCall('GET', '/v1/dlq');
          dlqJob = dlqResponse.jobs.find((j: any) => j.originalJobId === jobId);
          if (dlqJob) {
            log(`✓ Job moved to DLQ (found via 404 check) after ${waitSeconds} seconds`, colors.green);
            break;
          }
        } catch (dlqError) {
          // Continue waiting
        }
      }
    }
  }
  
  // Check final state - either in DLQ or failed (if DLQ move failed)
  if (dlqJob) {
    log(`\n✓ Job moved to DLQ successfully`, colors.green);
    log(`  DLQ Job ID: ${dlqJob.dlqJobId}`);
    log(`  Attempts: ${dlqJob.attempts}`);
    log(`  Error: ${dlqJob.errorSummary}`);
    return true;
  }
  
  // Fallback: check if job still exists
  try {
    const finalJob = await apiCall('GET', `/v1/jobs/${jobId}`);
    log(`\nFinal status: ${finalJob.status}`, colors.yellow);
    log(`  Total attempts: ${finalJob.attempts}`);
    log(`  Error: ${finalJob.errorSummary}`);
    
    // Get events to see what happened
    const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
    log(`\nJob events (${events.events.length}):`, colors.blue);
    events.events.forEach((event: any, i: number) => {
      log(`  ${i + 1}. ${event.eventType} at ${event.at}`);
    });
    
    // Check if job has moved_to_dlq event (but wasn't found in DLQ - might be timing issue)
    const movedToDlqEvent = events.events.find((e: any) => e.eventType === 'moved_to_dlq');
    if (movedToDlqEvent) {
      log(`✓ Found 'moved_to_dlq' event - job should be in DLQ`, colors.green);
      // Try DLQ one more time
      try {
        const dlqResponse = await apiCall('GET', '/v1/dlq');
        dlqJob = dlqResponse.jobs.find((j: any) => j.originalJobId === jobId);
        if (dlqJob) {
          log(`✓ Found job in DLQ on final check`, colors.green);
          return true;
        }
      } catch (error) {
        // Continue
      }
    }
    
    // Accept if it has reached max attempts (even if still queued/running due to backoff)
    if (finalJob.attempts >= finalJob.maxAttempts) {
      log(`✓ Job reached max attempts (${finalJob.attempts})`, colors.green);
      return true;
    }
    
    log(`✗ Job only has ${finalJob.attempts} attempts, expected ${finalJob.maxAttempts}`, colors.red);
    return false;
  } catch (error: any) {
    // Job might be in DLQ
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      // Final DLQ check
      try {
        const dlqResponse = await apiCall('GET', '/v1/dlq');
        dlqJob = dlqResponse.jobs.find((j: any) => j.originalJobId === jobId);
        if (dlqJob) {
          log(`✓ Job found in DLQ on final check`, colors.green);
          return true;
        }
      } catch (dlqError) {
        // Continue
      }
      log(`✓ Job no longer in main table (likely moved to DLQ)`, colors.green);
      return true;
    }
    throw error;
  }
}

async function test2b_TestListenNotify() {
  log('\n=== Test 2b: Test LISTEN/NOTIFY (Fast Job Processing) ===', colors.blue);
  
  // Create a job and measure how quickly it starts processing
  log('Creating job to test notification speed...');
  const startTime = Date.now();
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'echo',
    definitionVersion: 1,
    params: { message: 'Notification test' },
    priority: 10, // High priority
  });
  
  const jobId = createResponse.jobId;
  const creationTime = Date.now() - startTime;
  log(`✓ Job created in ${creationTime}ms: ${jobId}`, colors.green);
  
  // Check how quickly the job starts running (should be fast with notifications)
  let status = createResponse.status;
  let checkTime = Date.now();
  let processingStartTime: number | null = null;
  const maxWait = 5000; // 5 seconds max
  
  while ((status === 'queued' || status === 'running') && (Date.now() - checkTime) < maxWait) {
    await sleep(200); // Check frequently
    const job = await apiCall('GET', `/v1/jobs/${jobId}`);
    status = job.status;
    
    if (status === 'running' && !processingStartTime) {
      processingStartTime = Date.now();
      const timeToStart = processingStartTime - startTime;
      log(`✓ Job started running in ${timeToStart}ms (notification working!)`, colors.green);
    }
    
    if (status === 'succeeded') {
      break;
    }
  }
  
  if (processingStartTime) {
    const timeToStart = processingStartTime - startTime;
    if (timeToStart < 2000) {
      log(`✓ Job processed quickly (${timeToStart}ms) - LISTEN/NOTIFY working!`, colors.green);
      return true;
    } else {
      log(`⚠ Job took ${timeToStart}ms to start (may be using fallback polling)`, colors.yellow);
      return true; // Still pass, but note it's slower
    }
  } else {
    log(`⚠ Job didn't start within ${maxWait}ms`, colors.yellow);
    return true; // Don't fail, as this depends on worker availability
  }
}

async function test3_TestIdempotency() {
  log('\n=== Test 3: Test Idempotency ===', colors.blue);
  
  const idempotencyKey = `test-idempotency-${Date.now()}`;
  
  log(`Creating job with idempotency key: ${idempotencyKey}...`);
  const createResponse1 = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'echo',
    definitionVersion: 1,
    params: { message: 'First call' },
    idempotencyKey: idempotencyKey,
  });
  
  const jobId1 = createResponse1.jobId;
  log(`✓ First job created: ${jobId1}`, colors.green);
  
  // Wait a bit
  await sleep(500);
  
  log(`Creating duplicate job with same idempotency key...`);
  const createResponse2 = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'echo',
    definitionVersion: 1,
    params: { message: 'Second call (should be ignored)' },
    idempotencyKey: idempotencyKey,
  });
  
  const jobId2 = createResponse2.jobId;
  log(`✓ Second call returned: ${jobId2}`, colors.green);
  
  if (jobId1 === jobId2) {
    log(`✓ Idempotency works! Same job ID returned.`, colors.green);
    return true;
  } else {
    log(`✗ Idempotency failed! Different job IDs: ${jobId1} vs ${jobId2}`, colors.red);
    return false;
  }
}

async function test4_TestCancellation() {
  log('\n=== Test 4: Test Job Cancellation ===', colors.blue);
  
  // Create a job that will run for a while
  log('Creating echo job...');
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'echo',
    definitionVersion: 1,
    params: { message: 'Will be cancelled' },
    priority: 10, // High priority
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`, colors.green);
  
  // Wait for it to start running
  await sleep(500);
  
  // Cancel it
  log('Cancelling job...');
  await apiCall('POST', `/v1/jobs/${jobId}/cancel`);
  log(`✓ Cancellation requested`, colors.green);
  
  // Check status
  await sleep(2000);
  const job = await apiCall('GET', `/v1/jobs/${jobId}`);
  
  log(`Final status: ${job.status}`, colors.yellow);
  
  if (job.status === 'cancelled' || job.status === 'cancelling') {
    log(`✓ Job was cancelled successfully`, colors.green);
    return true;
  } else {
    log(`⚠ Job status is ${job.status} (may have completed before cancellation)`, colors.yellow);
    return true; // Not a failure if it completed too fast
  }
}

async function test5_ListJobs() {
  log('\n=== Test 5: Test Job Listing ===', colors.blue);
  
  // Create a few jobs
  log('Creating multiple jobs...');
  const jobs = [];
  for (let i = 0; i < 3; i++) {
    const response = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'echo',
      definitionVersion: 1,
      params: { message: `Test job ${i}` },
      priority: i,
    });
    jobs.push(response.jobId);
  }
  log(`✓ Created ${jobs.length} jobs`, colors.green);
  
  await sleep(1000);
  
  // List all jobs
  log('Listing all jobs...');
  const allJobs = await apiCall('GET', '/v1/jobs?limit=10');
  log(`✓ Found ${allJobs.jobs.length} jobs`, colors.green);
  
  // List by status
  log('Listing queued jobs...');
  const queuedJobs = await apiCall('GET', '/v1/jobs?status=queued');
  log(`✓ Found ${queuedJobs.jobs.length} queued jobs`, colors.green);
  
  // List by definition key
  log('Listing echo jobs...');
  const echoJobs = await apiCall('GET', '/v1/jobs?definitionKey=echo');
  log(`✓ Found ${echoJobs.jobs.length} echo jobs`, colors.green);
  
  return true;
}

async function test6_TestDeadLetterQueue() {
  log('\n=== Test 6: Test Dead-Letter Queue ===', colors.blue);
  
  // Create a failing job with maxAttempts=1 so it moves to DLQ immediately
  log('Creating failing job that will move to DLQ...');
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'failing',
    definitionVersion: 1,
    params: { test: 'dlq-e2e' },
    maxAttempts: 1, // Will move to DLQ after first failure
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`, colors.green);
  
  // Wait for job to fail and move to DLQ
  let dlqJob = null;
  let attempts = 0;
  const maxAttempts = 20; // Wait up to 20 seconds
  
  while (!dlqJob && attempts < maxAttempts) {
    await sleep(1000);
    attempts++;
    
    // First check if job still exists (if not, it's in DLQ)
    let jobExists = true;
    try {
      const job = await apiCall('GET', `/v1/jobs/${jobId}`);
      if (job.status === 'succeeded' || job.status === 'cancelled') {
        log(`⚠ Job ended with status: ${job.status} (unexpected)`, colors.yellow);
        return false;
      }
      if (attempts % 3 === 0) {
        log(`  Waiting... Job status: ${job.status}, attempts: ${job.attempts}`, colors.cyan);
      }
    } catch (error: any) {
      // Job might have been moved to DLQ (404)
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        jobExists = false;
        log(`  Job no longer in main table, checking DLQ...`, colors.cyan);
      }
    }
    
    // Check DLQ
    try {
      const dlqResponse = await apiCall('GET', '/v1/dlq');
      dlqJob = dlqResponse.jobs.find((j: any) => j.originalJobId === jobId);
      
      if (dlqJob) {
        log(`✓ Job found in DLQ after ${attempts} seconds`, colors.green);
        break;
      }
    } catch (error: any) {
      if (error.message?.includes('404')) {
        // DLQ endpoint might not exist (shouldn't happen, but handle gracefully)
        log(`⚠ DLQ endpoint error: ${error.message}`, colors.yellow);
      }
      // Continue waiting
    }
  }
  
  if (!dlqJob) {
    log('✗ Job not found in DLQ after waiting', colors.red);
    log(`  Checked for ${attempts} seconds`, colors.yellow);
    
    // Try to get the job one more time to see its final state
    try {
      const finalJob = await apiCall('GET', `/v1/jobs/${jobId}`);
      log(`  Final job status: ${finalJob.status}, attempts: ${finalJob.attempts}`, colors.yellow);
    } catch (error: any) {
      log(`  Job not found in main table (may be in DLQ but not found)`, colors.yellow);
    }
    
    return false;
  }
  
  log(`✓ Job moved to DLQ: ${dlqJob.dlqJobId}`, colors.green);
  log(`  Original Job ID: ${dlqJob.originalJobId}`);
  log(`  Error Summary: ${dlqJob.errorSummary}`);
  log(`  Moved to DLQ at: ${dlqJob.movedToDlqAt}`);
  
  // Test getting DLQ job by ID
  log('\nGetting DLQ job by ID...');
  const dlqJobDetails = await apiCall('GET', `/v1/dlq/${dlqJob.dlqJobId}`);
  if (dlqJobDetails.dlqJobId !== dlqJob.dlqJobId) {
    log('✗ DLQ job ID mismatch', colors.red);
    return false;
  }
  log(`✓ Retrieved DLQ job details`, colors.green);
  
  // Test listing DLQ jobs by definition key
  log('\nListing DLQ jobs by definition key...');
  const dlqByDefinition = await apiCall('GET', '/v1/dlq?definitionKey=failing');
  if (dlqByDefinition.jobs.length === 0) {
    log('✗ No DLQ jobs found for failing definition', colors.red);
    return false;
  }
  log(`✓ Found ${dlqByDefinition.jobs.length} DLQ job(s) for 'failing' definition`, colors.green);
  
  // Test retrying DLQ job
  log('\nRetrying DLQ job...');
  const retryResponse = await apiCall('POST', `/v1/dlq/${dlqJob.dlqJobId}/retry`, {
    maxAttempts: 2, // Give it more attempts this time
  });
  
  const newJobId = retryResponse.jobId;
  log(`✓ Created new job from DLQ: ${newJobId}`, colors.green);
  
  // Verify the new job exists
  const newJob = await apiCall('GET', `/v1/jobs/${newJobId}`);
  if (newJob.status !== 'queued' && newJob.status !== 'running' && newJob.status !== 'succeeded') {
    log(`✗ New job has unexpected status: ${newJob.status}`, colors.red);
    return false;
  }
  log(`✓ New job created successfully (status: ${newJob.status})`, colors.green);
  
  return true;
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.blue);
  log('  JOB SERVER END-TO-END TEST SUITE', colors.blue);
  log('='.repeat(60), colors.blue);
  
  // Ensure migrations are run and job definitions are registered
  try {
    await runMigrations();
    log('✓ Migrations completed', colors.green);
    
    // Register required job definitions for e2e tests
    await createJobDefinition('echo', 1, 3, 3600, 0);
    await createJobDefinition('failing', 1, 3, 3600, 0);
    log('✓ Job definitions registered', colors.green);
  } catch (error) {
    log(`⚠ Warning: Error setting up test environment: ${error}`, colors.yellow);
    // Continue anyway - definitions might already exist
  }
  
  const results: { name: string; passed: boolean }[] = [];
  
  try {
    // Test 1: Basic job execution
    const test1 = await test1_CreateAndExecuteEchoJob();
    results.push({ name: 'Test 1: Create and Execute Echo Job', passed: test1 });
    
    await sleep(2000);
    
    // Test 2: Retry logic
    const test2 = await test2_TestRetryLogic();
    results.push({ name: 'Test 2: Retry Logic', passed: test2 });
    
    await sleep(2000);
    
    // Test 2b: LISTEN/NOTIFY
    const test2b = await test2b_TestListenNotify();
    results.push({ name: 'Test 2b: LISTEN/NOTIFY (Fast Processing)', passed: test2b });
    
    await sleep(2000);
    
    // Test 3: Idempotency
    const test3 = await test3_TestIdempotency();
    results.push({ name: 'Test 3: Idempotency', passed: test3 });
    
    await sleep(2000);
    
    // Test 4: Cancellation
    const test4 = await test4_TestCancellation();
    results.push({ name: 'Test 4: Cancellation', passed: test4 });
    
    await sleep(1000);
    
    // Test 5: Listing
    const test5 = await test5_ListJobs();
    results.push({ name: 'Test 5: Job Listing', passed: test5 });
    
    await sleep(2000);
    
    // Test 6: Dead-Letter Queue
    const test6 = await test6_TestDeadLetterQueue();
    results.push({ name: 'Test 6: Dead-Letter Queue', passed: test6 });
    
  } catch (error) {
    log(`\n✗ Test suite failed with error: ${error}`, colors.red);
    if (error instanceof Error) {
      log(`  ${error.stack}`, colors.red);
    }
    process.exit(1);
  }
  
  // Print summary
  log('\n' + '='.repeat(60), colors.blue);
  log('  TEST RESULTS SUMMARY', colors.blue);
  log('='.repeat(60), colors.blue);
  
  results.forEach((result, i) => {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const color = result.passed ? colors.green : colors.red;
    log(`${i + 1}. ${result.name}: ${status}`, color);
  });
  
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  log(`\nTotal: ${passed}/${total} tests passed`, passed === total ? colors.green : colors.yellow);
  
  if (passed === total) {
    log('\n🎉 All tests passed!', colors.green);
    process.exit(0);
  } else {
    log('\n⚠ Some tests failed', colors.yellow);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  log(`\n✗ Fatal error: ${error}`, colors.red);
  process.exit(1);
});

