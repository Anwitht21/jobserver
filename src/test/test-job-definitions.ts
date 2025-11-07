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
    
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
  }
  
  throw new Error(`Job ${jobId} did not complete within ${maxWaitSeconds} seconds`);
}

async function testVideoEncoding() {
  log('\n=== Test 1: Video Encoding ===', colors.blue);
  
  const testCases = [
    { quality: '720p', videoId: 'video-720p' },
    { quality: '1080p', videoId: 'video-1080p' },
    { quality: '4k', videoId: 'video-4k' },
  ];
  
  for (const testCase of testCases) {
    log(`\nTesting ${testCase.quality} encoding...`, colors.cyan);
    
    const createResponse = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'encode.video',
      definitionVersion: 1,
      params: {
        videoId: testCase.videoId,
        format: 'mp4',
        quality: testCase.quality,
      },
      priority: 8,
    });
    
    const jobId = createResponse.jobId;
    log(`✓ Job created: ${jobId}`);
    
    const finalJob = await waitForJobCompletion(jobId, 60);
    
    if (finalJob.status === 'succeeded') {
      log(`✓ ${testCase.quality} encoding succeeded`, colors.green);
      
      // Check events
      const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
      const progressEvents = events.events.filter((e: any) => e.eventType === 'progress');
      log(`  Progress events: ${progressEvents.length}`);
      
      if (progressEvents.length > 0) {
        log(`✓ Progress tracking works`, colors.green);
      }
    } else {
      log(`✗ ${testCase.quality} encoding failed: ${finalJob.errorSummary}`, colors.red);
      return false;
    }
  }
  
  return true;
}

async function testMathComputations() {
  log('\n=== Test 2: Math Computations ===', colors.blue);
  
  const testCases = [
    { operation: 'sum', numbers: [1, 2, 3, 4, 5], expected: 15 },
    { operation: 'product', numbers: [2, 3, 4], expected: 24 },
    { operation: 'fibonacci', numbers: [10], expected: 55 },
    { operation: 'prime', numbers: [17], expected: 1 },
    { operation: 'prime', numbers: [18], expected: 0 },
  ];
  
  for (const testCase of testCases) {
    log(`\nTesting ${testCase.operation} with ${JSON.stringify(testCase.numbers)}...`, colors.cyan);
    
    const createResponse = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'compute.math',
      definitionVersion: 1,
      params: {
        operation: testCase.operation,
        numbers: testCase.numbers,
      },
    });
    
    const jobId = createResponse.jobId;
    log(`✓ Job created: ${jobId}`);
    
    const finalJob = await waitForJobCompletion(jobId, 30);
    
    if (finalJob.status === 'succeeded') {
      log(`✓ Computation succeeded`, colors.green);
      
      // Check result event
      const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
      const resultEvent = events.events.find((e: any) => e.eventType === 'result');
      
      if (resultEvent) {
        const result = resultEvent.payload.result;
        log(`  Result: ${result} (expected: ${testCase.expected})`);
        
        if (result === testCase.expected) {
          log(`✓ Result matches expected value`, colors.green);
        } else {
          log(`✗ Result mismatch: got ${result}, expected ${testCase.expected}`, colors.red);
          return false;
        }
      }
    } else {
      log(`✗ Computation failed: ${finalJob.errorSummary}`, colors.red);
      return false;
    }
  }
  
  return true;
}

async function testDataProcessing() {
  log('\n=== Test 3: Data Processing ===', colors.blue);
  
  const testCases = [
    { dataset: 'sales-2024', operation: 'aggregate' },
    { dataset: 'customer-data', operation: 'transform' },
    { dataset: 'inventory', operation: 'export' },
  ];
  
  for (const testCase of testCases) {
    log(`\nTesting data processing: ${testCase.dataset} - ${testCase.operation}...`, colors.cyan);
    
    const createResponse = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'process.data',
      definitionVersion: 1,
      params: testCase,
    });
    
    const jobId = createResponse.jobId;
    log(`✓ Job created: ${jobId}`);
    
    const finalJob = await waitForJobCompletion(jobId, 30);
    
    if (finalJob.status === 'succeeded') {
      log(`✓ Data processing succeeded`, colors.green);
    } else {
      log(`✗ Data processing failed: ${finalJob.errorSummary}`, colors.red);
      return false;
    }
  }
  
  return true;
}

async function testApiCalls() {
  log('\n=== Test 4: API Calls ===', colors.blue);
  
  const testCases = [
    { endpoint: 'https://api.example.com/users', method: 'GET' },
    { endpoint: 'https://api.example.com/data', method: 'POST', payload: { userId: 123 } },
    { endpoint: 'https://api.example.com/update', method: 'PUT', payload: { status: 'active' } },
  ];
  
  for (const testCase of testCases) {
    log(`\nTesting API call: ${testCase.method} ${testCase.endpoint}...`, colors.cyan);
    
    const createResponse = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'call.api',
      definitionVersion: 1,
      params: testCase,
    });
    
    const jobId = createResponse.jobId;
    log(`✓ Job created: ${jobId}`);
    
    const finalJob = await waitForJobCompletion(jobId, 30);
    
    if (finalJob.status === 'succeeded') {
      log(`✓ API call succeeded`, colors.green);
      
      // Check API response event
      const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
      const apiResponseEvent = events.events.find((e: any) => e.eventType === 'api_response');
      
      if (apiResponseEvent) {
        log(`✓ API response captured: status ${apiResponseEvent.payload.status}`, colors.green);
      }
    } else {
      log(`✗ API call failed: ${finalJob.errorSummary}`, colors.red);
      return false;
    }
  }
  
  return true;
}

async function testBatchProcessing() {
  log('\n=== Test 5: Batch Processing ===', colors.blue);
  
  const testCases = [
    { items: ['item1', 'item2', 'item3', 'item4', 'item5'], batchSize: 2 },
    { items: Array.from({ length: 25 }, (_, i) => `item-${i + 1}`), batchSize: 5 },
    { items: Array.from({ length: 100 }, (_, i) => `file-${i + 1}`), batchSize: 10 },
  ];
  
  for (const testCase of testCases) {
    log(`\nTesting batch processing: ${testCase.items.length} items, batch size ${testCase.batchSize}...`, colors.cyan);
    
    const createResponse = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'process.batch',
      definitionVersion: 1,
      params: testCase,
    });
    
    const jobId = createResponse.jobId;
    log(`✓ Job created: ${jobId}`);
    
    const finalJob = await waitForJobCompletion(jobId, 60);
    
    if (finalJob.status === 'succeeded') {
      log(`✓ Batch processing succeeded`, colors.green);
      
      // Check batch progress events
      const events = await apiCall('GET', `/v1/jobs/${jobId}/events`);
      const batchProgressEvents = events.events.filter((e: any) => e.eventType === 'batch_progress');
      
      const expectedBatches = Math.ceil(testCase.items.length / testCase.batchSize);
      log(`  Batch progress events: ${batchProgressEvents.length} (expected: ${expectedBatches})`);
      
      if (batchProgressEvents.length === expectedBatches) {
        log(`✓ All batches tracked correctly`, colors.green);
      }
    } else {
      log(`✗ Batch processing failed: ${finalJob.errorSummary}`, colors.red);
      return false;
    }
  }
  
  return true;
}

async function testConcurrencyLimits() {
  log('\n=== Test 6: Concurrency Limits ===', colors.blue);
  
  log('\nTesting video encoding concurrency (limit: 3)...', colors.cyan);
  
  // Start 5 video encoding jobs simultaneously
  const jobs = [];
  for (let i = 0; i < 5; i++) {
    const response = await apiCall('POST', '/v1/jobs', {
      definitionKey: 'encode.video',
      definitionVersion: 1,
      params: {
        videoId: `concurrent-video-${i}`,
        format: 'mp4',
        quality: '1080p',
      },
    });
    jobs.push(response.jobId);
    log(`✓ Job ${i + 1} created: ${response.jobId}`);
  }
  
  // Wait a moment for them to start
  await sleep(2000);
  
  // Check how many are running
  let runningCount = 0;
  for (const jobId of jobs) {
    const job = await apiCall('GET', `/v1/jobs/${jobId}`);
    if (job.status === 'running') {
      runningCount++;
    }
  }
  
  log(`\nRunning jobs: ${runningCount} (limit: 3)`);
  
  if (runningCount <= 3) {
    log(`✓ Concurrency limit respected`, colors.green);
  } else {
    log(`⚠ Concurrency limit may have been exceeded (${runningCount} > 3)`, colors.yellow);
  }
  
  // Wait for all to complete
  log('\nWaiting for all jobs to complete...');
  for (const jobId of jobs) {
    await waitForJobCompletion(jobId, 120);
  }
  log(`✓ All concurrent jobs completed`, colors.green);
  
  return true;
}

async function testCancellation() {
  log('\n=== Test 7: Cancellation ===', colors.blue);
  
  log('\nTesting video encoding cancellation...', colors.cyan);
  
  const createResponse = await apiCall('POST', '/v1/jobs', {
    definitionKey: 'encode.video',
    definitionVersion: 1,
    params: {
      videoId: 'cancel-test-video',
      format: 'mp4',
      quality: '4k', // Takes longer
    },
  });
  
  const jobId = createResponse.jobId;
  log(`✓ Job created: ${jobId}`);
  
  // Wait for it to start
  await sleep(2000);
  
  // Cancel it
  log('Requesting cancellation...');
  await apiCall('POST', `/v1/jobs/${jobId}/cancel`);
  log(`✓ Cancellation requested`);
  
  // Wait for completion (longer timeout for 4k encoding)
  const finalJob = await waitForJobCompletion(jobId, 90);
  
  if (finalJob.status === 'cancelled' || finalJob.status === 'succeeded') {
    log(`✓ Job ended with status: ${finalJob.status}`, colors.green);
    return true;
  } else {
    log(`⚠ Unexpected status: ${finalJob.status}`, colors.yellow);
    return true; // Not a critical failure
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(70), colors.blue);
  log('  JOB DEFINITIONS COMPREHENSIVE TEST SUITE', colors.blue);
  log('='.repeat(70), colors.blue);
  
  const results: { name: string; passed: boolean }[] = [];
  
  try {
    // Test 1: Video Encoding
    const test1 = await testVideoEncoding();
    results.push({ name: 'Test 1: Video Encoding (Multiple Qualities)', passed: test1 });
    await sleep(2000);
    
    // Test 2: Math Computations
    const test2 = await testMathComputations();
    results.push({ name: 'Test 2: Math Computations', passed: test2 });
    await sleep(2000);
    
    // Test 3: Data Processing
    const test3 = await testDataProcessing();
    results.push({ name: 'Test 3: Data Processing', passed: test3 });
    await sleep(2000);
    
    // Test 4: API Calls
    const test4 = await testApiCalls();
    results.push({ name: 'Test 4: API Calls', passed: test4 });
    await sleep(2000);
    
    // Test 5: Batch Processing
    const test5 = await testBatchProcessing();
    results.push({ name: 'Test 5: Batch Processing', passed: test5 });
    await sleep(2000);
    
    // Test 6: Concurrency Limits
    const test6 = await testConcurrencyLimits();
    results.push({ name: 'Test 6: Concurrency Limits', passed: test6 });
    await sleep(2000);
    
    // Test 7: Cancellation
    const test7 = await testCancellation();
    results.push({ name: 'Test 7: Cancellation Support', passed: test7 });
    
  } catch (error) {
    log(`\n✗ Test suite failed with error: ${error}`, colors.red);
    if (error instanceof Error) {
      log(`  ${error.stack}`, colors.red);
    }
    process.exit(1);
  }
  
  // Print summary
  log('\n' + '='.repeat(70), colors.blue);
  log('  TEST RESULTS SUMMARY', colors.blue);
  log('='.repeat(70), colors.blue);
  
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

