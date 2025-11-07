import { getPool } from './connection';

export async function runMigrations(): Promise<void> {
  const pool = getPool();
  
  // Create job_status enum
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE job_status AS ENUM (
        'queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled'
      );
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);
  
  // Create job_definitions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_definitions (
      key TEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      default_max_attempts INT NOT NULL DEFAULT 3,
      timeout_seconds INT NOT NULL DEFAULT 3600,
      concurrency_limit INT NOT NULL DEFAULT 0,
      PRIMARY KEY (key, version)
    );
  `);
  
  // Create jobs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id UUID PRIMARY KEY,
      definition_key TEXT NOT NULL,
      definition_version INT NOT NULL DEFAULT 1,
      params JSONB NOT NULL DEFAULT '{}',
      status job_status NOT NULL DEFAULT 'queued',
      priority INT NOT NULL DEFAULT 0,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 3,
      scheduled_at TIMESTAMPTZ,
      queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      lease_expires_at TIMESTAMPTZ,
      cancel_requested_at TIMESTAMPTZ,
      worker_id TEXT,
      idempotency_key TEXT,
      error_summary TEXT,
      CONSTRAINT fk_def FOREIGN KEY (definition_key, definition_version)
        REFERENCES job_definitions(key, version)
    );
  `);
  
  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jobs_status_priority 
    ON jobs(status, priority DESC, queued_at ASC);
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jobs_scheduled 
    ON jobs(scheduled_at) 
    WHERE status = 'queued';
  `);
  
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idemp 
    ON jobs(idempotency_key, definition_key, definition_version)
    WHERE idempotency_key IS NOT NULL;
  `);
  
  // Create job_events table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_events (
      id BIGSERIAL PRIMARY KEY,
      job_id UUID NOT NULL,
      event_type TEXT NOT NULL,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
  `);
  
  // Create schedules table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedules (
      id UUID PRIMARY KEY,
      definition_key TEXT NOT NULL,
      definition_version INT NOT NULL DEFAULT 1,
      cron TEXT NOT NULL,
      params JSONB NOT NULL DEFAULT '{}',
      priority INT NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_enqueued_at TIMESTAMPTZ,
      CONSTRAINT fk_schedule_def FOREIGN KEY (definition_key, definition_version)
        REFERENCES job_definitions(key, version)
    );
  `);
  
  console.log('Migrations completed successfully');
}

