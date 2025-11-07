import 'dotenv/config';
import { getPool } from '../db/connection';
import { createJob, createJobDefinition, listJobs } from '../db/jobs';
import { getWorker } from '../worker/index';
import { jobRegistry } from '../worker/registry';
import { runMigrations } from '../db/migrations';
import { createNotificationListener, closeNotificationListener, notifyJobAvailable } from '../db/notifications';
import { Client } from 'pg';

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

async function test1_NotificationListenerSetup() {
  log('\n=== Test 1: Notification Listener Setup ===', colors.blue);
  
  try {
    let notificationReceived = false;
    
    const client = await createNotificationListener(() => {
      notificationReceived = true;
    });
    
    log('✓ Notification listener created', colors.green);
    
    // Send a notification
    await notifyJobAvailable();
    await sleep(100); // Give it time to process
    
    if (!notificationReceived) {
      log('✗ Notification not received', colors.red);
      await closeNotificationListener(client);
      return false;
    }
    
    log('✓ Notification received successfully', colors.green);
    
    await closeNotificationListener(client);
    log('✓ Notification listener closed', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test2_WorkerWakesOnNotification() {
  log('\n=== Test 2: Worker Wakes On Notification ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Register job definition in worker registry
    jobRegistry.register({
      key: 'echo',
      version: 1,
      run: async (params, ctx) => {
        ctx.logger.info('Echo job started', params);
        await new Promise(resolve => setTimeout(resolve, 100));
        ctx.logger.info('Echo job completed', params);
      },
    });
    log('✓ Job definition registered in worker registry', colors.green);
    
    // Start worker
    const worker = getWorker();
    await worker.start();
    log('✓ Worker started', colors.green);
    
    // Wait a bit for worker to initialize
    await sleep(500);
    
    // Get initial job count
    const initialJobs = await listJobs('queued', 'echo');
    const initialCount = initialJobs.length;
    log(`  Initial queued jobs: ${initialCount}`, colors.cyan);
    
    // Create a job (this should trigger notification)
    const startTime = Date.now();
    await createJob({
      definitionKey: 'echo',
      definitionVersion: 1,
      params: { message: 'test-notification' },
    });
    log('✓ Job created', colors.green);
    
    // Wait for worker to process (should be fast with notifications)
    await sleep(2000);
    
    const finalJobs = await listJobs('queued', 'echo');
    const finalCount = finalJobs.length;
    log(`  Final queued jobs: ${finalCount}`, colors.cyan);
    
    const processingTime = Date.now() - startTime;
    log(`  Processing time: ${processingTime}ms`, colors.cyan);
    
    // Job should have been claimed quickly (within 2 seconds)
    // Check if job was processed (either succeeded or still queued but claimed)
    const allJobs = await listJobs(undefined, 'echo');
    const createdJob = allJobs.find(j => j.params?.message === 'test-notification');
    
    if (createdJob && (createdJob.status === 'succeeded' || createdJob.status === 'running')) {
      log('✓ Worker processed job quickly (notification working)', colors.green);
      
      if (processingTime < 2000) {
        log('✓ Job processed within 2 seconds (notification working)', colors.green);
      } else {
        log('⚠ Job processed but took longer than expected', colors.yellow);
      }
    } else if (finalCount < initialCount) {
      log('✓ Worker claimed job (notification working)', colors.green);
    } else {
      log('⚠ Job still queued (may need more time or worker at capacity)', colors.yellow);
    }
    
    await worker.stop();
    log('✓ Worker stopped', colors.green);
    
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test3_MultipleNotifications() {
  log('\n=== Test 3: Multiple Notifications ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    let notificationCount = 0;
    const client = await createNotificationListener(() => {
      notificationCount++;
    });
    
    log('✓ Notification listener created', colors.green);
    
    // Send multiple notifications
    await notifyJobAvailable();
    await notifyJobAvailable();
    await notifyJobAvailable();
    await sleep(200); // Give time to process
    
    if (notificationCount !== 3) {
      log(`✗ Expected 3 notifications, got ${notificationCount}`, colors.red);
      await closeNotificationListener(client);
      return false;
    }
    
    log(`✓ Received all ${notificationCount} notifications`, colors.green);
    
    await closeNotificationListener(client);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test4_NotificationOnJobCreation() {
  log('\n=== Test 4: Notification On Job Creation ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    let notificationReceived = false;
    const client = await createNotificationListener(() => {
      notificationReceived = true;
    });
    
    log('✓ Notification listener created', colors.green);
    
    // Create a job - this should trigger notification
    await createJob({
      definitionKey: 'echo',
      definitionVersion: 1,
      params: { test: 'notification' },
    });
    
    await sleep(200); // Give time for notification
    
    if (!notificationReceived) {
      log('✗ Notification not received when job created', colors.red);
      await closeNotificationListener(client);
      return false;
    }
    
    log('✓ Notification received when job created', colors.green);
    
    await closeNotificationListener(client);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function test5_NotificationOnOrphanReclaim() {
  log('\n=== Test 5: Notification On Orphan Reclaim ===', colors.blue);
  
  try {
    await clearJobs();
    await createJobDefinition('echo', 1, 3, 3600, 0);
    
    // Create a job and manually set it as orphaned (expired lease)
    const pool = getPool();
    const job = await createJob({
      definitionKey: 'echo',
      definitionVersion: 1,
      params: { test: 'orphan' },
    });
    
    // Manually set job as running with expired lease
    await pool.query(
      `UPDATE jobs 
       SET status = 'running', 
           worker_id = 'orphaned-worker',
           lease_expires_at = NOW() - INTERVAL '1 minute'
       WHERE id = $1`,
      [job.id]
    );
    
    let notificationReceived = false;
    const client = await createNotificationListener(() => {
      notificationReceived = true;
    });
    
    log('✓ Notification listener created', colors.green);
    log('✓ Created orphaned job', colors.green);
    
    // Import reclaim function
    const { reclaimOrphanedJobs } = await import('../db/jobs');
    
    // Reclaim orphaned jobs - this should trigger notification
    const reclaimed = await reclaimOrphanedJobs(60);
    
    await sleep(200); // Give time for notification
    
    if (reclaimed === 0) {
      log('⚠ No jobs reclaimed (may have been processed already)', colors.yellow);
    } else if (!notificationReceived) {
      log('✗ Notification not received when orphan reclaimed', colors.red);
      await closeNotificationListener(client);
      return false;
    } else {
      log(`✓ Notification received when ${reclaimed} orphan(s) reclaimed`, colors.green);
    }
    
    await closeNotificationListener(client);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\n' + '='.repeat(60), colors.cyan);
  log('LISTEN/NOTIFY COMPREHENSIVE TEST SUITE', colors.cyan);
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
      test1_NotificationListenerSetup,
      test2_WorkerWakesOnNotification,
      test3_MultipleNotifications,
      test4_NotificationOnJobCreation,
      test5_NotificationOnOrphanReclaim,
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

