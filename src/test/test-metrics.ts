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

async function testMetricsSummary() {
  log('\n=== Test: Metrics Summary ===', colors.blue);
  
  try {
    const metrics = await apiCall('GET', '/v1/metrics');
    
    // Validate structure
    if (!metrics.summary || !metrics.performance || !metrics.throughput) {
      throw new Error('Missing required fields in metrics response');
    }
    
    // Validate summary structure
    if (typeof metrics.summary.total !== 'number') {
      throw new Error('summary.total must be a number');
    }
    
    if (!metrics.summary.byStatus) {
      throw new Error('summary.byStatus is missing');
    }
    
    const requiredStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled'];
    for (const status of requiredStatuses) {
      if (typeof metrics.summary.byStatus[status] !== 'number') {
        throw new Error(`summary.byStatus.${status} must be a number`);
      }
    }
    
    log(`✓ Total jobs: ${metrics.summary.total}`, colors.green);
    log(`✓ Queued: ${metrics.summary.byStatus.queued}`, colors.green);
    log(`✓ Running: ${metrics.summary.byStatus.running}`, colors.green);
    log(`✓ Succeeded: ${metrics.summary.byStatus.succeeded}`, colors.green);
    log(`✓ Failed: ${metrics.summary.byStatus.failed}`, colors.green);
    
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testPerformanceMetrics() {
  log('\n=== Test: Performance Metrics ===', colors.blue);
  
  try {
    const performance = await apiCall('GET', '/v1/metrics/performance');
    
    // Validate structure
    if (typeof performance.successRate !== 'number') {
      throw new Error('successRate must be a number');
    }
    
    if (performance.successRate < 0 || performance.successRate > 1) {
      throw new Error('successRate must be between 0 and 1');
    }
    
    if (typeof performance.retryRate !== 'number') {
      throw new Error('retryRate must be a number');
    }
    
    if (performance.retryRate < 0 || performance.retryRate > 1) {
      throw new Error('retryRate must be between 0 and 1');
    }
    
    log(`✓ Success rate: ${(performance.successRate * 100).toFixed(2)}%`, colors.green);
    log(`✓ Retry rate: ${(performance.retryRate * 100).toFixed(2)}%`, colors.green);
    log(`✓ Avg processing time: ${performance.avgProcessingTime ? performance.avgProcessingTime.toFixed(2) + 's' : 'N/A'}`, colors.green);
    log(`✓ Avg queue time: ${performance.avgQueueTime ? performance.avgQueueTime.toFixed(2) + 's' : 'N/A'}`, colors.green);
    
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testDefinitionMetrics() {
  log('\n=== Test: Definition Metrics ===', colors.blue);
  
  try {
    const response = await apiCall('GET', '/v1/metrics/definitions');
    
    if (!Array.isArray(response.definitions)) {
      throw new Error('definitions must be an array');
    }
    
    log(`✓ Found ${response.definitions.length} job definition(s)`, colors.green);
    
    // Validate each definition metric
    for (const def of response.definitions) {
      if (!def.definitionKey || typeof def.definitionKey !== 'string') {
        throw new Error('definitionKey must be a string');
      }
      
      if (typeof def.definitionVersion !== 'number') {
        throw new Error('definitionVersion must be a number');
      }
      
      if (typeof def.total !== 'number') {
        throw new Error('total must be a number');
      }
      
      if (typeof def.successRate !== 'number') {
        throw new Error('successRate must be a number');
      }
      
      log(`  - ${def.definitionKey}@${def.definitionVersion}: ${def.total} jobs, ${(def.successRate * 100).toFixed(2)}% success`, colors.green);
    }
    
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testThroughputMetrics() {
  log('\n=== Test: Throughput Metrics ===', colors.blue);
  
  try {
    // Test default (24 hours)
    const response = await apiCall('GET', '/v1/metrics/throughput');
    
    if (!Array.isArray(response.data)) {
      throw new Error('data must be an array');
    }
    
    log(`✓ Found ${response.data.length} data point(s) for last 24 hours`, colors.green);
    
    // Validate data points
    for (const point of response.data) {
      if (!point.period || typeof point.period !== 'string') {
        throw new Error('period must be a string');
      }
      
      if (typeof point.completed !== 'number') {
        throw new Error('completed must be a number');
      }
      
      if (typeof point.failed !== 'number') {
        throw new Error('failed must be a number');
      }
    }
    
    // Test custom hours parameter
    const customResponse = await apiCall('GET', '/v1/metrics/throughput?hours=12');
    log(`✓ Custom hours parameter works: ${customResponse.data.length} data point(s)`, colors.green);
    
    // Test invalid hours parameter
    try {
      await apiCall('GET', '/v1/metrics/throughput?hours=200');
      throw new Error('Should have rejected hours > 168');
    } catch (error: any) {
      if (error.message.includes('400')) {
        log(`✓ Invalid hours parameter correctly rejected`, colors.green);
      } else {
        throw error;
      }
    }
    
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testMetricsCache() {
  log('\n=== Test: Metrics Cache ===', colors.blue);
  
  try {
    // Make two requests quickly - second should be cached
    const start1 = Date.now();
    await apiCall('GET', '/v1/metrics');
    const time1 = Date.now() - start1;
    
    const start2 = Date.now();
    await apiCall('GET', '/v1/metrics');
    const time2 = Date.now() - start2;
    
    log(`✓ First request: ${time1}ms`, colors.green);
    log(`✓ Second request: ${time2}ms`, colors.green);
    
    if (time2 < time1) {
      log(`✓ Cache appears to be working (second request faster)`, colors.green);
    } else {
      log(`⚠ Cache may not be working as expected`, colors.yellow);
    }
    
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.blue);
  log('METRICS API TESTS', colors.blue);
  log('='.repeat(60), colors.blue);
  
  const results = await Promise.all([
    testMetricsSummary(),
    testPerformanceMetrics(),
    testDefinitionMetrics(),
    testThroughputMetrics(),
    testMetricsCache(),
  ]);
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  log('\n' + '='.repeat(60), colors.blue);
  log(`RESULTS: ${passed}/${total} tests passed`, passed === total ? colors.green : colors.yellow);
  log('='.repeat(60), colors.blue);
  
  if (passed !== total) {
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  log(`\n✗ Test runner failed: ${error.message}`, colors.red);
  process.exit(1);
});

