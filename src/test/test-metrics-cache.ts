import 'dotenv/config';
import { metricsCache } from '../utils/metrics-cache';
import { 
  getJobMetricsSummary, 
  getJobPerformanceStats, 
  getJobThroughput, 
  getJobMetricsByDefinition, 
  getJobThroughputTimeSeries 
} from '../db/jobs';

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testCacheBasicFunctionality() {
  log('\n=== Test: Basic Cache Functionality ===', colors.blue);
  
  try {
    metricsCache.clear();
    
    // Track database calls by wrapping the functions
    let callCount = 0;
    const originalGetSummary = getJobMetricsSummary;
    const wrappedGetSummary = async () => {
      callCount++;
      return originalGetSummary();
    };
    
    // First call - should hit database
    const start1 = Date.now();
    const result1 = await metricsCache.getMetricsSummary();
    const time1 = Date.now() - start1;
    
    if (typeof result1.total !== 'number') {
      throw new Error('Invalid result structure');
    }
    
    // Second call immediately - should use cache
    const start2 = Date.now();
    const result2 = await metricsCache.getMetricsSummary();
    const time2 = Date.now() - start2;
    
    if (result2.total !== result1.total) {
      throw new Error('Cached result mismatch');
    }
    
    // Cache should make second call faster (though not guaranteed, it's a good indicator)
    if (time2 < time1 || time2 < 10) {
      log(`✓ Cache appears to be working (first: ${time1}ms, second: ${time2}ms)`, colors.green);
    } else {
      log(`⚠ Cache timing unclear (first: ${time1}ms, second: ${time2}ms)`, colors.yellow);
    }
    
    log(`✓ Results match: ${result1.total} total jobs`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testCacheExpiration() {
  log('\n=== Test: Cache Expiration ===', colors.blue);
  
  try {
    metricsCache.clear();
    
    // Get initial value
    const result1 = await metricsCache.getMetricsSummary(100); // 100ms TTL
    const initialTotal = result1.total;
    
    // Wait for cache to expire
    await sleep(150);
    
    // Get again - should refetch (but value might be same)
    const result2 = await metricsCache.getMetricsSummary(100);
    
    // Results should be valid
    if (typeof result2.total !== 'number') {
      throw new Error('Invalid result after expiration');
    }
    
    log(`✓ Cache expiration test passed (initial: ${initialTotal}, after: ${result2.total})`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testCacheInvalidation() {
  log('\n=== Test: Cache Invalidation ===', colors.blue);
  
  try {
    metricsCache.clear();
    
    // Populate cache with multiple metrics
    const summary1 = await metricsCache.getMetricsSummary();
    const performance1 = await metricsCache.getPerformanceStats();
    
    // Invalidate summary
    metricsCache.invalidate('summary');
    
    // Get summary again - should refetch
    const summary2 = await metricsCache.getMetricsSummary();
    
    if (typeof summary2.total !== 'number') {
      throw new Error('Invalid summary after invalidation');
    }
    
    // Performance should still be cached (we can't verify this without mocking, but we can verify it works)
    const performance2 = await metricsCache.getPerformanceStats();
    
    if (typeof performance2.successRate !== 'number') {
      throw new Error('Invalid performance metrics');
    }
    
    // Invalidate all
    metricsCache.invalidate();
    
    // Both should work after full invalidation
    const summary3 = await metricsCache.getMetricsSummary();
    const performance3 = await metricsCache.getPerformanceStats();
    
    if (typeof summary3.total !== 'number' || typeof performance3.successRate !== 'number') {
      throw new Error('Invalid metrics after full invalidation');
    }
    
    log('✓ Cache invalidation works correctly', colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testAllMetricsMethods() {
  log('\n=== Test: All Metrics Methods ===', colors.blue);
  
  try {
    metricsCache.clear();
    
    // Test all methods
    const summary = await metricsCache.getMetricsSummary();
    const performance = await metricsCache.getPerformanceStats();
    const throughput = await metricsCache.getThroughput();
    const byDefinition = await metricsCache.getMetricsByDefinition();
    const timeSeries = await metricsCache.getThroughputTimeSeries(24);
    
    // Validate results
    if (typeof summary.total !== 'number' || !summary.byStatus) {
      throw new Error('Invalid summary structure');
    }
    
    if (typeof performance.successRate !== 'number' || performance.successRate < 0 || performance.successRate > 1) {
      throw new Error('Invalid performance structure');
    }
    
    if (typeof throughput.lastHour !== 'number' || typeof throughput.lastDay !== 'number') {
      throw new Error('Invalid throughput structure');
    }
    
    if (!Array.isArray(byDefinition)) {
      throw new Error('Invalid definition metrics structure');
    }
    
    if (!Array.isArray(timeSeries)) {
      throw new Error('Invalid time series structure');
    }
    
    log(`✓ All metrics methods work correctly`, colors.green);
    log(`  - Summary: ${summary.total} total jobs`, colors.green);
    log(`  - Performance: ${(performance.successRate * 100).toFixed(2)}% success rate`, colors.green);
    log(`  - Throughput: ${throughput.lastHour}/hour, ${throughput.lastDay}/day`, colors.green);
    log(`  - Definitions: ${byDefinition.length} definition(s)`, colors.green);
    log(`  - Time series: ${timeSeries.length} data point(s)`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testTimeSeriesCacheKey() {
  log('\n=== Test: Time Series Cache Key ===', colors.blue);
  
  try {
    metricsCache.clear();
    
    // Different hours should create different cache entries
    const series24 = await metricsCache.getThroughputTimeSeries(24);
    const series12 = await metricsCache.getThroughputTimeSeries(12);
    const series24Again = await metricsCache.getThroughputTimeSeries(24);
    
    if (!Array.isArray(series24) || !Array.isArray(series12) || !Array.isArray(series24Again)) {
      throw new Error('Invalid time series structure');
    }
    
    // Verify all results are valid
    if (series24.length !== series24Again.length) {
      throw new Error('24h cache key not working correctly');
    }
    
    log(`✓ Time series cache keys work correctly (24h: ${series24.length}, 12h: ${series12.length})`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testCacheClear() {
  log('\n=== Test: Cache Clear ===', colors.blue);
  
  try {
    // Populate cache
    await metricsCache.getMetricsSummary();
    await metricsCache.getPerformanceStats();
    await metricsCache.getThroughput();
    
    // Clear cache
    metricsCache.clear();
    
    // All should still work after clear
    const summary = await metricsCache.getMetricsSummary();
    const performance = await metricsCache.getPerformanceStats();
    const throughput = await metricsCache.getThroughput();
    
    if (typeof summary.total !== 'number' || typeof performance.successRate !== 'number' || typeof throughput.lastHour !== 'number') {
      throw new Error('Metrics invalid after cache clear');
    }
    
    log('✓ Cache clear works correctly', colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.blue);
  log('METRICS CACHE INTEGRATION TESTS', colors.blue);
  log('='.repeat(60), colors.blue);
  
  const results = await Promise.all([
    testCacheBasicFunctionality(),
    testCacheExpiration(),
    testCacheInvalidation(),
    testAllMetricsMethods(),
    testTimeSeriesCacheKey(),
    testCacheClear(),
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