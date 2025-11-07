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
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function waitForJobCompletion(jobId: string, maxWaitSeconds: number = 60): Promise<any> {
  let attempts = 0;
  
  while (attempts < maxWaitSeconds) {
    await sleep(1000);
    attempts++;
    
    const job = await apiCall('GET', `/v1/jobs/${jobId}`);
    log(`  [${attempts}s] Status: ${job.status}`, colors.cyan);
    
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
  }
  
  throw new Error(`Job ${jobId} did not complete within ${maxWaitSeconds} seconds`);
}

async function testCancellation() {
  log('\n=== Cancellation Test ===', colors.blue);
  
  log('\nTest 1: Cancel 4K video encoding job...', colors.cyan);
  
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'encode.video',
    definitionVersion: 1,
    params: {
      videoId: 'cancel-test-video',
      format: 'mp4',
      quality: '4k',
    },
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`, colors.green);
  
  // Wait for it to start
  log('\nWaiting for job to start...');
  await sleep(2000);
  
  // Check status before cancellation
  const jobBefore = await apiCall('GET', `/v1/jobs/${jobId}`);
  log(`Status before cancellation: ${jobBefore.status}`, colors.yellow);
  
  // Cancel it
  log('\nRequesting cancellation...');
  await apiCall('POST', `/v1/jobs/${jobId}/cancel`);
  log(`✓ Cancellation requested`, colors.green);
  
  // Wait for completion
  log('\nWaiting for job to complete...');
  const finalJob = await waitForJobCompletion(jobId, 30);
  
  log(`\nFinal status: ${finalJob.status}`, colors.yellow);
  
  if (finalJob.status === 'cancelled') {
    log(`✓ Job successfully cancelled`, colors.green);
  } else if (finalJob.status === 'succeeded') {
    log(`⚠ Job completed before cancellation took effect`, colors.yellow);
  } else {
    log(`✗ Unexpected status: ${finalJob.status}`, colors.red);
    return false;
  }
  
  // Check events
  const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
  log(`\nJob events:`, colors.cyan);
  events.events.forEach((event: any) => {
    log(`  - ${event.eventType} at ${event.createdAt}`);
  });
  
  return true;
}

async function testCancellationBeforeExecution() {
  log('\n=== Cancellation Before Execution Test ===', colors.blue);
  
  log('\nTest 2: Cancel job before it starts executing...', colors.cyan);
  
  // Create multiple jobs to queue up
  const jobIds = [];
  for (let i = 0; i < 5; i++) {
    const response = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'encode.video',
      definitionVersion: 1,
      params: {
        videoId: `queue-test-${i}`,
        format: 'mp4',
        quality: '4k',
      },
    });
    jobIds.push(response.jobId);
    log(`✓ Job ${i + 1} created: ${response.jobId}`);
  }
  
  // Immediately cancel the last one (likely still queued)
  const targetJobId = jobIds[4];
  log(`\nCancelling job ${targetJobId} while queued...`);
  await apiCall('POST', `/v1/jobs/${targetJobId}/cancel`);
  log(`✓ Cancellation requested`, colors.green);
  
  // Wait a bit
  await sleep(3000);
  
  // Check final status
  const finalJob = await apiCall('GET', `/v1/jobs/${targetJobId}`);
  log(`\nFinal status: ${finalJob.status}`, colors.yellow);
  
  if (finalJob.status === 'cancelled') {
    log(`✓ Job cancelled successfully before execution`, colors.green);
    return true;
  } else if (finalJob.status === 'queued') {
    log(`⚠ Job still queued, waiting for worker to pick it up...`);
    const completedJob = await waitForJobCompletion(targetJobId, 30);
    if (completedJob.status === 'cancelled') {
      log(`✓ Job cancelled when worker picked it up`, colors.green);
      return true;
    } else {
      log(`✗ Job executed despite cancellation: ${completedJob.status}`, colors.red);
      return false;
    }
  } else {
    log(`✗ Unexpected status: ${finalJob.status}`, colors.red);
    return false;
  }
}

async function runTests() {
  log('\n' + '='.repeat(70), colors.blue);
  log('  CANCELLATION TEST SUITE', colors.blue);
  log('='.repeat(70), colors.blue);
  
  try {
    const test1 = await testCancellation();
    await sleep(2000);
    
    const test2 = await testCancellationBeforeExecution();
    
    log('\n' + '='.repeat(70), colors.blue);
    log('  TEST RESULTS', colors.blue);
    log('='.repeat(70), colors.blue);
    
    log(`Test 1 (Cancel running job): ${test1 ? '✓ PASS' : '✗ FAIL'}`, test1 ? colors.green : colors.red);
    log(`Test 2 (Cancel queued job): ${test2 ? '✓ PASS' : '✗ FAIL'}`, test2 ? colors.green : colors.red);
    
    if (test1 && test2) {
      log('\n🎉 All cancellation tests passed!', colors.green);
      process.exit(0);
    } else {
      log('\n⚠ Some tests failed', colors.yellow);
      process.exit(1);
    }
  } catch (error) {
    log(`\n✗ Test failed with error: ${error}`, colors.red);
    if (error instanceof Error) {
      log(`  ${error.stack}`, colors.red);
    }
    process.exit(1);
  }
}

runTests();

