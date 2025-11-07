import { getPool } from './connection';
import { Job, JobStatus, CreateJobRequest, JobEvent } from '../types';
import { v4 as uuidv4 } from 'uuid';

export async function createJobDefinition(
  key: string,
  version: number,
  defaultMaxAttempts: number = 3,
  timeoutSeconds: number = 3600,
  concurrencyLimit: number = 0
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO job_definitions (key, version, default_max_attempts, timeout_seconds, concurrency_limit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key, version) DO UPDATE SET
       default_max_attempts = EXCLUDED.default_max_attempts,
       timeout_seconds = EXCLUDED.timeout_seconds,
       concurrency_limit = EXCLUDED.concurrency_limit`,
    [key, version, defaultMaxAttempts, timeoutSeconds, concurrencyLimit]
  );
}

export async function createJob(request: CreateJobRequest): Promise<Job> {
  const pool = getPool();
  const definitionVersion = request.definitionVersion ?? 1;
  
  // Check for idempotency
  if (request.idempotencyKey) {
    const existing = await pool.query(
      `SELECT * FROM jobs
       WHERE idempotency_key = $1
         AND definition_key = $2
         AND definition_version = $3
         AND status IN ('queued', 'running')
       LIMIT 1`,
      [request.idempotencyKey, request.definitionKey, definitionVersion]
    );
    
    if (existing.rows.length > 0) {
      return mapRowToJob(existing.rows[0]);
    }
  }
  
  const jobId = uuidv4();
  
  // Get default max attempts from definition
  const defResult = await pool.query(
    'SELECT default_max_attempts FROM job_definitions WHERE key = $1 AND version = $2',
    [request.definitionKey, definitionVersion]
  );
  
  const maxAttempts = request.maxAttempts ?? defResult.rows[0]?.default_max_attempts ?? 3;
  
  const result = await pool.query(
    `INSERT INTO jobs (
      id, definition_key, definition_version, params, status, priority,
      max_attempts, queued_at, idempotency_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
    RETURNING *`,
    [
      jobId,
      request.definitionKey,
      definitionVersion,
      JSON.stringify(request.params ?? {}),
      'queued',
      request.priority ?? 0,
      maxAttempts,
      request.idempotencyKey ?? null,
    ]
  );
  
  return mapRowToJob(result.rows[0]);
}

export async function getJobById(jobId: string): Promise<Job | null> {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToJob(result.rows[0]);
}

export async function claimJob(workerId: string, leaseDurationSeconds: number): Promise<Job | null> {
  const pool = getPool();
  
  // Check for scheduled jobs first, then regular queued jobs
  const result = await pool.query(
    `SELECT id FROM jobs
     WHERE status = 'queued'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
     ORDER BY priority DESC, queued_at ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1`
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const jobId = result.rows[0].id;
  
  // Update job to running status
  const updateResult = await pool.query(
    `UPDATE jobs
     SET status = 'running',
         worker_id = $1,
         started_at = NOW(),
         heartbeat_at = NOW(),
         lease_expires_at = NOW() + INTERVAL '1 second' * $2
     WHERE id = $3
     RETURNING *`,
    [workerId, leaseDurationSeconds, jobId]
  );
  
  if (updateResult.rows.length === 0) {
    return null;
  }
  
  return mapRowToJob(updateResult.rows[0]);
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  errorSummary?: string
): Promise<void> {
  const pool = getPool();
  const updates: string[] = ['status = $1'];
  const values: unknown[] = [status];
  let paramIndex = 2;
  
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    updates.push(`finished_at = NOW()`);
  }
  
  if (errorSummary !== undefined) {
    updates.push(`error_summary = $${paramIndex}`);
    values.push(errorSummary);
    paramIndex++;
  }
  
  await pool.query(
    `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    [...values, jobId]
  );
}

export async function incrementAttempts(jobId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'UPDATE jobs SET attempts = attempts + 1 WHERE id = $1',
    [jobId]
  );
}

export async function scheduleRetry(jobId: string, scheduledAt: Date): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE jobs
     SET status = 'queued',
         scheduled_at = $1,
         worker_id = NULL,
         started_at = NULL,
         heartbeat_at = NULL,
         lease_expires_at = NULL
     WHERE id = $2`,
    [scheduledAt, jobId]
  );
}

export async function updateHeartbeat(jobId: string, leaseDurationSeconds: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE jobs
     SET heartbeat_at = NOW(),
         lease_expires_at = NOW() + INTERVAL '1 second' * $1
     WHERE id = $2`,
    [leaseDurationSeconds, jobId]
  );
}

export async function requestCancellation(jobId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE jobs
     SET cancel_requested_at = NOW(),
         status = CASE WHEN status = 'running' THEN 'cancelling' ELSE status END
     WHERE id = $1`,
    [jobId]
  );
}

export async function reclaimOrphanedJobs(leaseDurationSeconds: number): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'queued',
         worker_id = NULL,
         started_at = NULL,
         heartbeat_at = NULL,
         lease_expires_at = NULL
     WHERE status IN ('running', 'cancelling')
       AND lease_expires_at < NOW()
     RETURNING id`
  );
  return result.rowCount ?? 0;
}

export async function listJobs(
  status?: JobStatus,
  definitionKey?: string,
  limit: number = 100,
  offset: number = 0
): Promise<Job[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;
  
  if (status) {
    conditions.push(`status = $${paramIndex}`);
    values.push(status);
    paramIndex++;
  }
  
  if (definitionKey) {
    conditions.push(`definition_key = $${paramIndex}`);
    values.push(definitionKey);
    paramIndex++;
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const result = await pool.query(
    `SELECT * FROM jobs
     ${whereClause}
     ORDER BY queued_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...values, limit, offset]
  );
  
  return result.rows.map(mapRowToJob);
}

export async function createJobEvent(
  jobId: string,
  eventType: string,
  payload?: Record<string, unknown>
): Promise<JobEvent> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO job_events (job_id, event_type, payload)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [jobId, eventType, payload ? JSON.stringify(payload) : null]
  );
  
  return {
    id: result.rows[0].id,
    jobId: result.rows[0].job_id,
    eventType: result.rows[0].event_type,
    at: result.rows[0].at,
    payload: result.rows[0].payload ? JSON.parse(result.rows[0].payload) : null,
  };
}

export async function getJobEvents(jobId: string): Promise<JobEvent[]> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT * FROM job_events WHERE job_id = $1 ORDER BY at ASC',
    [jobId]
  );
  
  return result.rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    eventType: row.event_type,
    at: row.at,
    payload: row.payload ? JSON.parse(row.payload) : null,
  }));
}

function mapRowToJob(row: any): Job {
  return {
    id: row.id,
    definitionKey: row.definition_key,
    definitionVersion: row.definition_version,
    params: row.params ? JSON.parse(row.params) : {},
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    heartbeatAt: row.heartbeat_at,
    leaseExpiresAt: row.lease_expires_at,
    cancelRequestedAt: row.cancel_requested_at,
    workerId: row.worker_id,
    idempotencyKey: row.idempotency_key,
    errorSummary: row.error_summary,
  };
}

