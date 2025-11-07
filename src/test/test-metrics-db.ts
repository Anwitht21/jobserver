import 'dotenv/config';
import { getPool } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { 
  createJobDefinition, 
  createJob, 
  updateJobStatus,
  getJobMetricsSummary,
  getJobPerformanceStats,
  getJobThroughput,
  getJobMetricsByDefinition,
  getJobThroughputTimeSeries
} from '../db/jobs';
import { v4 as uuidv4 } from 'uuid';

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

async function clearJobs(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM job_events');
  await pool.query('DELETE FROM jobs_dlq');
  await pool.query('DELETE FROM jobs');
  await pool.query('DELETE FROM job_definitions');
}

async function testMetricsSummary() {
  log('\n=== Test: Metrics Summary ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `metrics-test.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create jobs in different states
    const job1 = await createJob({ definitionKey, definitionVersion: 1, params: {} });
    const job2 = await createJob({ definitionKey, definitionVersion: 1, params: {} });
    const job3 = await createJob({ definitionKey, definitionVersion: 1, params: {} });
    
    // Set different statuses
    await updateJobStatus(job1.id, 'succeeded');
    await updateJobStatus(job2.id, 'failed');
    // job3 remains queued
    
    const summary = await getJobMetricsSummary();
    
    // Validate structure
    if (typeof summary.total !== 'number') {
      throw new Error('total must be a number');
    }
    
    if (!summary.byStatus) {
      throw new Error('byStatus is missing');
    }
    
    const requiredStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled'];
    for (const status of requiredStatuses) {
      if (typeof summary.byStatus[status as keyof typeof summary.byStatus] !== 'number') {
        throw new Error(`byStatus.${status} must be a number`);
      }
    }
    
    if (summary.total < 3) {
      throw new Error(`Expected at least 3 jobs, got ${summary.total}`);
    }
    
    log(`✓ Metrics summary works correctly (total: ${summary.total})`, colors.green);
    log(`  - Queued: ${summary.byStatus.queued}, Succeeded: ${summary.byStatus.succeeded}, Failed: ${summary.byStatus.failed}`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testPerformanceStats() {
  log('\n=== Test: Performance Stats ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `perf-test.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create and complete jobs
    const job1 = await createJob({ definitionKey, definitionVersion: 1, params: {} });
    const job2 = await createJob({ definitionKey, definitionVersion: 1, params: {} });
    const job3 = await createJob({ definitionKey, definitionVersion: 1, params: {} });
    
    // Set timestamps and statuses
    const pool = getPool();
    const now = new Date();
    const startedAt = new Date(now.getTime() - 2000); // 2 seconds ago
    const finishedAt = new Date(now.getTime() - 1000); // 1 second ago
    
    await pool.query(
      `UPDATE jobs SET status = 'succeeded', started_at = $1, finished_at = $2 WHERE id = $3`,
      [startedAt, finishedAt, job1.id]
    );
    
    await pool.query(
      `UPDATE jobs SET status = 'succeeded', started_at = $1, finished_at = $2 WHERE id = $3`,
      [startedAt, finishedAt, job2.id]
    );
    
    await pool.query(
      `UPDATE jobs SET status = 'failed', started_at = $1, finished_at = $2 WHERE id = $3`,
      [startedAt, finishedAt, job3.id]
    );
    
    const stats = await getJobPerformanceStats();
    
    // Validate structure
    if (typeof stats.successRate !== 'number' || stats.successRate < 0 || stats.successRate > 1) {
      throw new Error('successRate must be between 0 and 1');
    }
    
    if (stats.avgProcessingTime !== null && typeof stats.avgProcessingTime !== 'number') {
      throw new Error('avgProcessingTime must be a number or null');
    }
    
    if (stats.avgQueueTime !== null && typeof stats.avgQueueTime !== 'number') {
      throw new Error('avgQueueTime must be a number or null');
    }
    
    if (typeof stats.retryRate !== 'number' || stats.retryRate < 0 || stats.retryRate > 1) {
      throw new Error('retryRate must be between 0 and 1');
    }
    
    // With 2 succeeded and 1 failed, success rate should be ~0.67
    if (stats.successRate < 0.5 || stats.successRate > 1) {
      throw new Error(`Unexpected success rate: ${stats.successRate}`);
    }
    
    log(`✓ Performance stats work correctly`, colors.green);
    log(`  - Success rate: ${(stats.successRate * 100).toFixed(2)}%`, colors.green);
    log(`  - Retry rate: ${(stats.retryRate * 100).toFixed(2)}%`, colors.green);
    log(`  - Avg processing time: ${stats.avgProcessingTime ? stats.avgProcessingTime.toFixed(2) + 's' : 'N/A'}`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testThroughput() {
  log('\n=== Test: Throughput ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `throughput-test.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create some jobs
    const jobs = [];
    for (let i = 0; i < 5; i++) {
      jobs.push(await createJob({ definitionKey, definitionVersion: 1, params: {} }));
    }
    
    // Set some as finished recently
    const pool = getPool();
    const now = new Date();
    
    // Mark some as finished in last hour
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `UPDATE jobs SET status = 'succeeded', finished_at = $1 WHERE id = $2`,
        [now, jobs[i].id]
      );
    }
    
    const throughput = await getJobThroughput();
    
    // Validate structure
    if (typeof throughput.lastHour !== 'number' || throughput.lastHour < 0) {
      throw new Error('lastHour must be a non-negative number');
    }
    
    if (typeof throughput.lastDay !== 'number' || throughput.lastDay < 0) {
      throw new Error('lastDay must be a non-negative number');
    }
    
    if (typeof throughput.lastWeek !== 'number' || throughput.lastWeek < 0) {
      throw new Error('lastWeek must be a non-negative number');
    }
    
    if (throughput.lastHour < 3) {
      throw new Error(`Expected at least 3 jobs in last hour, got ${throughput.lastHour}`);
    }
    
    log(`✓ Throughput works correctly`, colors.green);
    log(`  - Last hour: ${throughput.lastHour}, Last day: ${throughput.lastDay}, Last week: ${throughput.lastWeek}`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testMetricsByDefinition() {
  log('\n=== Test: Metrics By Definition ===', colors.blue);
  
  try {
    await clearJobs();
    
    const defKey1 = `def-metrics-1.${uuidv4()}`;
    const defKey2 = `def-metrics-2.${uuidv4()}`;
    
    await createJobDefinition(defKey1, 1, 3, 3600, 0);
    await createJobDefinition(defKey2, 1, 3, 3600, 0);
    
    // Create jobs for each definition
    const job1 = await createJob({ definitionKey: defKey1, definitionVersion: 1, params: {} });
    const job2 = await createJob({ definitionKey: defKey1, definitionVersion: 1, params: {} });
    const job3 = await createJob({ definitionKey: defKey2, definitionVersion: 1, params: {} });
    
    // Set statuses
    await updateJobStatus(job1.id, 'succeeded');
    await updateJobStatus(job2.id, 'failed');
    // job3 remains queued
    
    const metrics = await getJobMetricsByDefinition();
    
    if (!Array.isArray(metrics)) {
      throw new Error('Metrics must be an array');
    }
    
    // Should have at least our 2 definitions
    if (metrics.length < 2) {
      throw new Error(`Expected at least 2 definitions, got ${metrics.length}`);
    }
    
    // Validate structure of each metric
    for (const metric of metrics) {
      if (typeof metric.definitionKey !== 'string') {
        throw new Error('definitionKey must be a string');
      }
      
      if (typeof metric.definitionVersion !== 'number') {
        throw new Error('definitionVersion must be a number');
      }
      
      if (typeof metric.total !== 'number') {
        throw new Error('total must be a number');
      }
      
      if (!metric.byStatus) {
        throw new Error('byStatus is missing');
      }
      
      if (typeof metric.successRate !== 'number' || metric.successRate < 0 || metric.successRate > 1) {
        throw new Error('successRate must be between 0 and 1');
      }
    }
    
    log(`✓ Metrics by definition work correctly (${metrics.length} definition(s))`, colors.green);
    for (const metric of metrics.slice(0, 3)) {
      log(`  - ${metric.definitionKey}@${metric.definitionVersion}: ${metric.total} jobs, ${(metric.successRate * 100).toFixed(2)}% success`, colors.green);
    }
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testThroughputTimeSeries() {
  log('\n=== Test: Throughput Time Series ===', colors.blue);
  
  try {
    await clearJobs();
    
    const definitionKey = `timeseries-test.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);
    
    // Create some jobs
    const jobs = [];
    for (let i = 0; i < 5; i++) {
      jobs.push(await createJob({ definitionKey, definitionVersion: 1, params: {} }));
    }
    
    // Set finished_at timestamps
    const pool = getPool();
    const now = new Date();
    
    for (let i = 0; i < 5; i++) {
      const finishedAt = new Date(now.getTime() - i * 3600000); // Spread over hours
      await pool.query(
        `UPDATE jobs SET status = ${i % 2 === 0 ? "'succeeded'" : "'failed'"}, finished_at = $1 WHERE id = $2`,
        [finishedAt, jobs[i].id]
      );
    }
    
    const timeSeries = await getJobThroughputTimeSeries(24);
    
    if (!Array.isArray(timeSeries)) {
      throw new Error('Time series must be an array');
    }
    
    // Validate structure
    for (const point of timeSeries) {
      if (typeof point.period !== 'string') {
        throw new Error('period must be a string');
      }
      
      if (typeof point.completed !== 'number' || point.completed < 0) {
        throw new Error('completed must be a non-negative number');
      }
      
      if (typeof point.failed !== 'number' || point.failed < 0) {
        throw new Error('failed must be a non-negative number');
      }
    }
    
    log(`✓ Throughput time series works correctly (${timeSeries.length} data point(s))`, colors.green);
    if (timeSeries.length > 0) {
      log(`  - Sample: ${timeSeries[0].period} - ${timeSeries[0].completed} completed, ${timeSeries[0].failed} failed`, colors.green);
    }
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function testEmptyDatabase() {
  log('\n=== Test: Empty Database Handling ===', colors.blue);
  
  try {
    // Clear everything first
    await clearJobs();
    
    // Wait a bit to ensure timestamps are different
    await sleep(100);
    
    // Test all metrics functions with empty database
    const summary = await getJobMetricsSummary();
    const performance = await getJobPerformanceStats();
    const throughput = await getJobThroughput();
    const byDefinition = await getJobMetricsByDefinition();
    const timeSeries = await getJobThroughputTimeSeries(24);
    
    // All should return valid structures even with empty data
    if (summary.total < 0) {
      throw new Error(`Invalid total jobs: ${summary.total}`);
    }
    
    if (performance.successRate < 0 || performance.successRate > 1) {
      throw new Error(`Invalid success rate: ${performance.successRate}`);
    }
    
    if (throughput.lastHour < 0) {
      throw new Error(`Invalid lastHour: ${throughput.lastHour}`);
    }
    
    if (!Array.isArray(byDefinition)) {
      throw new Error('byDefinition must be an array');
    }
    
    if (!Array.isArray(timeSeries)) {
      throw new Error('timeSeries must be an array');
    }
    
    log(`✓ Empty database handling works correctly (total: ${summary.total}, successRate: ${performance.successRate})`, colors.green);
    return true;
  } catch (error) {
    log(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.blue);
  log('METRICS DATABASE INTEGRATION TESTS', colors.blue);
  log('='.repeat(60), colors.blue);
  
  // Run migrations first
  await runMigrations();
  
  // Run tests sequentially to avoid interference
  const results = [
    await testMetricsSummary(),
    await testPerformanceStats(),
    await testThroughput(),
    await testMetricsByDefinition(),
    await testThroughputTimeSeries(),
    await testEmptyDatabase(),
  ];
  
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
  console.error(error);
  process.exit(1);
});
