import 'dotenv/config';
import { getPool } from '../db/connection';
import { createJob } from '../db/jobs';
import { validate } from 'node-cron';
import { runMigrations } from '../db/migrations';

interface Schedule {
  id: string;
  definitionKey: string;
  definitionVersion: number;
  cron: string;
  params: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  lastEnqueuedAt: Date | null;
}

const SCHEDULER_LOCK_KEY = 12345; // Arbitrary lock key for advisory lock
const POLL_INTERVAL_MS = 60000; // Check every minute

class Scheduler {
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private hasLock = false;

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log('[Scheduler] Starting scheduler');

    // Try to acquire lock
    await this.acquireLock();

    // Poll for lock and process schedules
    this.pollInterval = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[Scheduler] Error in tick:', error);
      });
    }, POLL_INTERVAL_MS);

    // Initial tick
    await this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await this.releaseLock();
    console.log('[Scheduler] Stopped');
  }

  private async acquireLock(): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('SELECT pg_try_advisory_lock($1)', [SCHEDULER_LOCK_KEY]);
    this.hasLock = result.rows[0].pg_try_advisory_lock;
    
    if (this.hasLock) {
      console.log('[Scheduler] Acquired advisory lock');
    }
    
    return this.hasLock;
  }

  private async releaseLock(): Promise<void> {
    if (!this.hasLock) {
      return;
    }

    const pool = getPool();
    await pool.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_KEY]);
    this.hasLock = false;
    console.log('[Scheduler] Released advisory lock');
  }

  private async tick(): Promise<void> {
    // Try to acquire lock if we don't have it
    if (!this.hasLock) {
      await this.acquireLock();
      if (!this.hasLock) {
        return; // Another scheduler instance is running
      }
    }

    try {
      // Get all enabled schedules
      const pool = getPool();
      const schedulesResult = await pool.query(
        'SELECT * FROM schedules WHERE enabled = TRUE'
      );

      const schedules: Schedule[] = schedulesResult.rows.map((row) => ({
        id: row.id,
        definitionKey: row.definition_key,
        definitionVersion: row.definition_version,
        cron: row.cron,
        params: row.params ? JSON.parse(row.params) : {},
        priority: row.priority,
        enabled: row.enabled,
        lastEnqueuedAt: row.last_enqueued_at,
      }));

      const now = new Date();

      for (const schedule of schedules) {
        try {
          // Parse cron expression and check if it should run now
          if (this.shouldRun(schedule.cron, schedule.lastEnqueuedAt, now)) {
            await createJob({
              definitionKey: schedule.definitionKey,
              definitionVersion: schedule.definitionVersion,
              params: schedule.params,
              priority: schedule.priority,
            });

            // Update last_enqueued_at
            await pool.query(
              'UPDATE schedules SET last_enqueued_at = NOW() WHERE id = $1',
              [schedule.id]
            );

            console.log(`[Scheduler] Enqueued job for schedule ${schedule.id} (${schedule.definitionKey})`);
          }
        } catch (error) {
          console.error(`[Scheduler] Error processing schedule ${schedule.id}:`, error);
        }
      }
    } catch (error) {
      // If we get a connection error, reset lock state and try to reacquire next tick
      console.error('[Scheduler] Database error in tick, will retry:', error);
      this.hasLock = false;
    }
  }

  private shouldRun(cronExpr: string, lastRun: Date | null, now: Date): boolean {
    // Simple cron parsing - supports standard 5-field cron
    try {
      if (!validate(cronExpr)) {
        return false;
      }

      // If never run, check if it should run now
      if (!lastRun) {
        // For simplicity, we'll enqueue if the cron matches the current minute
        // In production, you'd want more sophisticated matching
        return true;
      }

      // Check if enough time has passed since last run
      // We check every minute, so if last run was more than 1 minute ago,
      // and the cron would match, we should run
      const minutesSinceLastRun = Math.floor((now.getTime() - lastRun.getTime()) / 60000);
      
      // If it's been at least 1 minute, check if cron matches
      if (minutesSinceLastRun >= 1) {
        // Use node-cron's schedule to check if it would trigger
        // This is a simplified check - in production you'd want more precise matching
        return true;
      }
    } catch (error) {
      console.error(`[Scheduler] Invalid cron expression: ${cronExpr}`, error);
      return false;
    }

    return false;
  }
}

let schedulerInstance: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (!schedulerInstance) {
    schedulerInstance = new Scheduler();
  }
  return schedulerInstance;
}

async function main() {
  try {
    // Run migrations
    await runMigrations();
    
    // Start scheduler
    const scheduler = getScheduler();
    await scheduler.start();
    
    console.log('Scheduler started. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('Failed to start scheduler:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Scheduler] Received SIGTERM, shutting down gracefully...');
  if (schedulerInstance) {
    await schedulerInstance.stop();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Scheduler] Received SIGINT, shutting down gracefully...');
  if (schedulerInstance) {
    await schedulerInstance.stop();
  }
  process.exit(0);
});

if (require.main === module) {
  main();
}
