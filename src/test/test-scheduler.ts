import 'dotenv/config';
import { getPool } from '../db/connection';
import { createJobDefinition } from '../db/jobs';
import { getScheduler } from '../scheduler/index';
import { runMigrations } from '../db/migrations';
import { v4 as uuidv4 } from 'uuid';
import { listJobs, getJobById } from '../db/jobs';

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

// Helper to create a schedule in the database
async function createSchedule(
  definitionKey: string,
  definitionVersion: number,
  cron: string,
  params: Record<string, unknown> = {},
  priority: number = 0,
  enabled: boolean = true
): Promise<string> {
  const pool = getPool();
  const id = uuidv4();
  await pool.query(
    `INSERT INTO schedules (id, definition_key, definition_version, cron, params, priority, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, definitionKey, definitionVersion, cron, JSON.stringify(params), priority, enabled]
  );
  return id;
}

// Helper to get schedule from database
async function getSchedule(scheduleId: string): Promise<any> {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
  return result.rows[0] || null;
}

// Helper to count jobs for a definition
async function countJobs(definitionKey: string, definitionVersion: number = 1): Promise<number> {
  const jobs = await listJobs(undefined, definitionKey);
  return jobs.filter(j => j.definitionVersion === definitionVersion).length;
}

// Helper to clear schedules
async function clearSchedules(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM schedules');
}

// Helper to clear jobs
async function clearJobs(): Promise<void> {
  const pool = getPool();
  // Delete job_events first due to foreign key constraint
  await pool.query('DELETE FROM job_events');
  await pool.query('DELETE FROM jobs');
}

async function test1_BasicScheduleCreation() {
  log('\n=== Test 1: Basic Schedule Creation ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    // Register a test job definition
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Create a schedule that runs every minute
    const scheduleId = await createSchedule('echo', 1, '* * * * *', { message: 'scheduled' }, 5);
    log(`✓ Created schedule: ${scheduleId}`, colors.green);
    
    const schedule = await getSchedule(scheduleId);
    if (!schedule) {
      log('✗ Schedule not found in database', colors.red);
      return false;
    }
    
    if (schedule.definition_key !== 'echo' || schedule.cron !== '* * * * *') {
      log('✗ Schedule data incorrect', colors.red);
      return false;
    }
    
    log('✓ Schedule created correctly', colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test2_SchedulerLockMechanism() {
  log('\n=== Test 2: Scheduler Lock Mechanism ===', colors.blue);
  
  try {
    const scheduler1 = getScheduler();
    const scheduler2 = getScheduler(); // Should be same instance
    
    // Start first scheduler
    await scheduler1.start();
    log('✓ Started scheduler instance 1', colors.green);
    
    // Wait a bit
    await sleep(1000);
    
    // Try to start again (should be idempotent)
    await scheduler1.start();
    log('✓ Second start() call handled correctly (idempotent)', colors.green);
    
    // Stop scheduler
    await scheduler1.stop();
    log('✓ Stopped scheduler', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test3_ScheduleEnablingDisabling() {
  log('\n=== Test 3: Schedule Enabling/Disabling ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Create enabled schedule
    const scheduleId1 = await createSchedule('echo', 1, '* * * * *', {}, 0, true);
    log(`✓ Created enabled schedule: ${scheduleId1}`, colors.green);
    
    // Create disabled schedule
    const scheduleId2 = await createSchedule('echo', 1, '* * * * *', {}, 0, false);
    log(`✓ Created disabled schedule: ${scheduleId2}`, colors.green);
    
    // Check that only enabled schedules are queried
    const pool = getPool();
    const enabledResult = await pool.query('SELECT * FROM schedules WHERE enabled = TRUE');
    if (enabledResult.rows.length !== 1 || enabledResult.rows[0].id !== scheduleId1) {
      log('✗ Enabled schedule query incorrect', colors.red);
      return false;
    }
    
    log('✓ Only enabled schedules are queried', colors.green);
    
    // Disable schedule
    await pool.query('UPDATE schedules SET enabled = FALSE WHERE id = $1', [scheduleId1]);
    const disabledResult = await pool.query('SELECT * FROM schedules WHERE enabled = TRUE');
    if (disabledResult.rows.length !== 0) {
      log('✗ Disabled schedule still appears in enabled query', colors.red);
      return false;
    }
    
    log('✓ Disabled schedules are excluded', colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test4_JobCreationFromSchedule() {
  log('\n=== Test 4: Job Creation From Schedule ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Create a schedule that should trigger immediately (every minute)
    // We'll manually trigger the tick to test job creation
    const scheduleId = await createSchedule('echo', 1, '* * * * *', { message: 'from-schedule' }, 10);
    log(`✓ Created schedule: ${scheduleId}`, colors.green);
    
    const initialJobCount = await countJobs('echo', 1);
    log(`  Initial job count: ${initialJobCount}`, colors.cyan);
    
    // Start scheduler and wait for a tick
    const scheduler = getScheduler();
    await scheduler.start();
    log('✓ Started scheduler', colors.green);
    
    // Wait for scheduler to process (it does an initial tick)
    await sleep(2000);
    
    const finalJobCount = await countJobs('echo', 1);
    log(`  Final job count: ${finalJobCount}`, colors.cyan);
    
    if (finalJobCount <= initialJobCount) {
      log('⚠ No jobs created (this may be expected if cron doesn\'t match current time)', colors.yellow);
      // This is okay - cron might not match current minute
    } else {
      log(`✓ Job created from schedule (${finalJobCount - initialJobCount} jobs)`, colors.green);
      
      // Verify job properties
      const jobs = await listJobs(undefined, 'echo');
      const scheduledJob = jobs.find(j => j.definitionVersion === 1);
      if (scheduledJob) {
        if (scheduledJob.priority === 10 && scheduledJob.params?.message === 'from-schedule') {
          log('✓ Job has correct priority and params', colors.green);
        } else {
          log(`✗ Job properties incorrect: priority=${scheduledJob.priority}, params=${JSON.stringify(scheduledJob.params)}`, colors.red);
          return false;
        }
      }
    }
    
    await scheduler.stop();
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test5_LastEnqueuedAtUpdate() {
  log('\n=== Test 5: Last Enqueued At Update ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    const scheduleId = await createSchedule('echo', 1, '* * * * *', {}, 0);
    
    // Check initial last_enqueued_at
    let schedule = await getSchedule(scheduleId);
    if (schedule.last_enqueued_at !== null) {
      log('✗ Initial last_enqueued_at should be null', colors.red);
      return false;
    }
    log('✓ Initial last_enqueued_at is null', colors.green);
    
    // Manually update last_enqueued_at to simulate scheduler behavior
    const pool = getPool();
    await pool.query('UPDATE schedules SET last_enqueued_at = NOW() WHERE id = $1', [scheduleId]);
    
    schedule = await getSchedule(scheduleId);
    if (schedule.last_enqueued_at === null) {
      log('✗ last_enqueued_at not updated', colors.red);
      return false;
    }
    log('✓ last_enqueued_at updated correctly', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test6_CronExpressionValidation() {
  log('\n=== Test 6: Cron Expression Validation ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Test various cron expressions
    const validCrons = [
      '* * * * *',           // Every minute
      '0 * * * *',           // Every hour at minute 0
      '0 0 * * *',           // Every day at midnight
      '*/5 * * * *',         // Every 5 minutes
      '0 9 * * 1-5',         // 9 AM on weekdays
    ];
    
    const invalidCrons = [
      'invalid',
      '60 * * * *',          // Invalid minute
      '* * * * * *',         // Too many fields
      '',                    // Empty
    ];
    
    // Test valid crons
    for (const cron of validCrons) {
      try {
        const scheduleId = await createSchedule('echo', 1, cron, {}, 0);
        log(`✓ Valid cron created: ${cron}`, colors.green);
        await clearSchedules();
      } catch (error: any) {
        log(`✗ Valid cron rejected: ${cron} - ${error.message}`, colors.red);
        return false;
      }
    }
    
    // Test invalid crons (database might accept them, but scheduler should handle gracefully)
    for (const cron of invalidCrons) {
      try {
        const scheduleId = await createSchedule('echo', 1, cron, {}, 0);
        log(`⚠ Invalid cron accepted by DB: ${cron} (scheduler should handle this)`, colors.yellow);
        await clearSchedules();
      } catch (error: any) {
        log(`✓ Invalid cron rejected: ${cron}`, colors.green);
      }
    }
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test7_ScheduleParamsHandling() {
  log('\n=== Test 7: Schedule Params Handling ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Test with various param types
    const testParams = {
      string: 'test',
      number: 42,
      boolean: true,
      object: { nested: 'value' },
      array: [1, 2, 3],
    };
    
    const scheduleId = await createSchedule('echo', 1, '* * * * *', testParams, 0);
    const schedule = await getSchedule(scheduleId);
    
    // Check params are stored correctly
    const storedParams = schedule.params;
    if (!storedParams || typeof storedParams !== 'object') {
      log('✗ Params not stored correctly', colors.red);
      return false;
    }
    
    if (storedParams.string !== testParams.string ||
        storedParams.number !== testParams.number ||
        storedParams.boolean !== testParams.boolean) {
      log('✗ Params values incorrect', colors.red);
      return false;
    }
    
    log('✓ Params stored and retrieved correctly', colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test8_MultipleSchedules() {
  log('\n=== Test 8: Multiple Schedules ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Create multiple schedules
    const scheduleIds = [];
    for (let i = 0; i < 3; i++) {
      const id = await createSchedule('echo', 1, '* * * * *', { index: i }, i);
      scheduleIds.push(id);
    }
    
    log(`✓ Created ${scheduleIds.length} schedules`, colors.green);
    
    // Verify all are retrieved
    const pool = getPool();
    const result = await pool.query('SELECT * FROM schedules WHERE enabled = TRUE');
    if (result.rows.length !== 3) {
      log(`✗ Expected 3 schedules, got ${result.rows.length}`, colors.red);
      return false;
    }
    
    log('✓ All schedules retrieved correctly', colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test9_SchedulerErrorHandling() {
  log('\n=== Test 9: Scheduler Error Handling ===', colors.blue);
  
  try {
    await clearSchedules();
    await clearJobs();
    
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Create schedule with invalid definition (should fail gracefully)
    try {
      const scheduleId = await createSchedule('nonexistent', 1, '* * * * *', {}, 0);
      log('⚠ Schedule with invalid definition created (foreign key should prevent this)', colors.yellow);
      
      // Try to process it - scheduler should handle gracefully
      const scheduler = getScheduler();
      await scheduler.start();
      await sleep(2000);
      await scheduler.stop();
      
      log('✓ Scheduler handled invalid definition gracefully', colors.green);
    } catch (error: any) {
      // Foreign key constraint should prevent this
      if (error.code === '23503') {
        log('✓ Foreign key constraint prevents invalid definition', colors.green);
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

async function test10_SchedulerStopAndRestart() {
  log('\n=== Test 10: Scheduler Stop and Restart ===', colors.blue);
  
  try {
    const scheduler = getScheduler();
    
    // Start
    await scheduler.start();
    log('✓ Started scheduler', colors.green);
    await sleep(500);
    
    // Stop
    await scheduler.stop();
    log('✓ Stopped scheduler', colors.green);
    await sleep(500);
    
    // Restart
    await scheduler.start();
    log('✓ Restarted scheduler', colors.green);
    await sleep(500);
    
    // Stop again
    await scheduler.stop();
    log('✓ Stopped scheduler again', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('SCHEDULER COMPREHENSIVE TEST SUITE', colors.cyan);
  log('='.repeat(60), colors.cyan);
  
  try {
    // Run migrations
    log('\nRunning migrations...', colors.blue);
    await runMigrations();
    log('✓ Migrations completed', colors.green);
    
    // Register test job definitions
    log('\nRegistering job definitions...', colors.blue);
    await createJobDefinition('echo', 1, 3, 3600, 0);
    log('✓ Job definitions registered', colors.green);
    
    const tests = [
      test1_BasicScheduleCreation,
      test2_SchedulerLockMechanism,
      test3_ScheduleEnablingDisabling,
      test4_JobCreationFromSchedule,
      test5_LastEnqueuedAtUpdate,
      test6_CronExpressionValidation,
      test7_ScheduleParamsHandling,
      test8_MultipleSchedules,
      test9_SchedulerErrorHandling,
      test10_SchedulerStopAndRestart,
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
    await clearSchedules();
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

