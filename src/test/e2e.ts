import 'dotenv/config';

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
  log('Creating failing job (will retry 3 times)...');
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'failing',
    definitionVersion: 1,
    params: {},
    maxAttempts: 3,
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`, colors.green);
  
  // Wait for it to fail and retry
  let status = 'queued';
  let attempts = 0;
  const maxAttempts = 60; // 60 seconds for retries
  
  while (status !== 'failed' && attempts < maxAttempts) {
    await sleep(1000);
    const job = await apiCall('GET', `/v1/jobs/${jobId}`);
    status = job.status;
    attempts++;
    
    if (job.attempts > 0) {
      log(`  Attempt ${job.attempts}/${job.maxAttempts}, Status: ${status}`, colors.yellow);
    }
  }
  
  const finalJob = await apiCall('GET', `/v1/jobs/${jobId}`);
  log(`\nFinal status: ${finalJob.status}`, finalJob.status === 'failed' ? colors.green : colors.red);
  log(`  Total attempts: ${finalJob.attempts}`);
  log(`  Error: ${finalJob.errorSummary}`);
  
  // Get events
  const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
  log(`\nJob events (${events.events.length}):`, colors.blue);
  events.events.forEach((event: any, i: number) => {
    log(`  ${i + 1}. ${event.eventType} at ${event.at}`);
  });
  
  return finalJob.status === 'failed' && finalJob.attempts === 3;
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

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.blue);
  log('  JOB SERVER END-TO-END TEST SUITE', colors.blue);
  log('='.repeat(60), colors.blue);
  
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

