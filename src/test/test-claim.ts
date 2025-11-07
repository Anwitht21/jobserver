import 'dotenv/config';
import { getPool } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { createJobDefinition, createJob, claimJob } from '../db/jobs';
import { Job } from '../types';
import { v4 as uuidv4 } from 'uuid';

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

async function clearJobs(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM job_events');
  await pool.query('DELETE FROM jobs');
}

async function test1_DoubleClaimSingleJob(): Promise<boolean> {
  log('\n=== Test 1: Double Claim Single Job ===', colors.blue);

  try {
    await clearJobs();

    const definitionKey = `concurrency.test.${uuidv4()}`;
    await createJobDefinition(definitionKey, 1, 3, 3600, 0);

    const job = await createJob({
      definitionKey,
      definitionVersion: 1,
      params: { attempt: 'double-claim' },
      priority: 5,
    });

    log(`✓ Created job ${job.id}`, colors.green);

    const workerIds = ['worker-a', 'worker-b', 'worker-c', 'worker-d'];
    const claimPromises = workerIds.map((workerId) => claimJob(workerId, 60));
    const results = await Promise.all(claimPromises);

    const claimedJobs = results.filter((result): result is Job => result !== null);

    if (claimedJobs.length !== 1) {
      log(`✗ Expected exactly one claim, but got ${claimedJobs.length}`, colors.red);
      return false;
    }

    const claimedJob = claimedJobs[0];
    const claimingWorker = claimedJob.workerId;

    if (!claimingWorker || !workerIds.includes(claimingWorker)) {
      log('✗ Claimed job missing worker assignment', colors.red);
      return false;
    }

    log(`✓ Job claimed by ${claimingWorker}`, colors.green);

    const duplicateClaims = claimedJobs.filter((cj) => cj.id === claimedJob.id);
    if (duplicateClaims.length !== 1) {
      log('✗ Job was claimed by multiple workers simultaneously', colors.red);
      return false;
    }

    const pool = getPool();
    const dbRow = await pool.query(
      'SELECT status, worker_id FROM jobs WHERE id = $1',
      [claimedJob.id]
    );

    if (dbRow.rows.length !== 1) {
      log('✗ Unable to load claimed job from database', colors.red);
      return false;
    }

    const { status, worker_id: workerId } = dbRow.rows[0];

    if (status !== 'running' || workerId !== claimingWorker) {
      log(`✗ Job has unexpected status (${status}) or worker (${workerId})`, colors.red);
      return false;
    }

    const followUpClaims = await Promise.all(
      workerIds.map((workerId) => claimJob(`${workerId}-retry`, 60))
    );

    const secondaryClaims = followUpClaims.filter((result): result is Job => result !== null);
    if (secondaryClaims.length !== 0) {
      log('✗ Job was claimed again after initial assignment', colors.red);
      return false;
    }

    log('✓ Subsequent claims returned null as expected', colors.green);
    return true;
  } catch (error: any) {
    log(`✗ Error: ${error.message}`, colors.red);
    return false;
  }
}

async function main() {
  await runMigrations();

  const tests: Array<{ label: string; fn: () => Promise<boolean> }> = [
    { label: 'Double claim single job', fn: test1_DoubleClaimSingleJob },
  ];

  let passed = 0;

  for (const test of tests) {
    const result = await test.fn();
    if (result) {
      passed++;
      log(`✓ ${test.label}`, colors.green);
    } else {
      log(`✗ ${test.label}`, colors.red);
    }
  }

  log(`\n${passed}/${tests.length} tests passed`, passed === tests.length ? colors.green : colors.red);

  if (passed !== tests.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  log(`✗ Unhandled error: ${error.message}`, colors.red);
  process.exit(1);
});

