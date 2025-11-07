import { getPool } from './connection';
import { Job, JobStatus, CreateJobRequest, JobEvent, JobMetricsSummary, JobPerformanceStats, JobThroughput, DefinitionMetrics, ThroughputDataPoint, JobStatusCounts, DlqJob } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { notifyJobAvailable } from './notifications';

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
  
  // Check if job definition exists first
  const defCheckResult = await pool.query(
    'SELECT default_max_attempts FROM job_definitions WHERE key = $1 AND version = $2',
    [request.definitionKey, definitionVersion]
  );
  
  if (defCheckResult.rows.length === 0) {
    throw new Error(
      `Job definition "${request.definitionKey}@${definitionVersion}" not found. ` +
      `Please register it first using: npm run register-definitions`
    );
  }
  
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
  const maxAttempts = request.maxAttempts ?? defCheckResult.rows[0].default_max_attempts ?? 3;
  
  try {
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
    
    const job = mapRowToJob(result.rows[0]);
    
    // Notify workers that a new job is available
    // Don't await to avoid blocking job creation
    notifyJobAvailable().catch((error) => {
      console.error('[createJob] Error sending notification:', error);
    });
    
    return job;
  } catch (error: any) {
    // Handle foreign key constraint violations
    if (error.code === '23503') {
      throw new Error(
        `Job definition "${request.definitionKey}@${definitionVersion}" not found in database. ` +
        `Please register it first using: npm run register-definitions`
      );
    }
    throw error;
  }
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
  // Exclude jobs that have been cancelled
  const result = await pool.query(
    `SELECT id FROM jobs
     WHERE status = 'queued'
       AND (scheduled_at IS NULL OR scheduled_at <= NOW())
       AND cancel_requested_at IS NULL
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
         status = CASE 
           WHEN status = 'running' THEN 'cancelling'
           WHEN status = 'queued' THEN 'cancelled'
           ELSE status 
         END,
         finished_at = CASE 
           WHEN status = 'queued' THEN NOW()
           ELSE finished_at
         END
     WHERE id = $1`,
    [jobId]
  );
  
  // Emit cancelled event for queued jobs
  const result = await pool.query(
    `SELECT status FROM jobs WHERE id = $1`,
    [jobId]
  );
  
  if (result.rows.length > 0 && result.rows[0].status === 'cancelled') {
    await createJobEvent(jobId, 'cancelled', { reason: 'cancelled_while_queued' });
  }
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
  const reclaimed = result.rowCount ?? 0;
  
  // Notify workers if any jobs were reclaimed
  if (reclaimed > 0) {
    notifyJobAvailable().catch((error) => {
      console.error('[reclaimOrphanedJobs] Error sending notification:', error);
    });
  }
  
  return reclaimed;
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
    // PostgreSQL JSONB columns are already parsed as objects by pg library
    payload: result.rows[0].payload || null,
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
    // PostgreSQL JSONB columns are already parsed as objects by pg library
    payload: row.payload || null,
  }));
}

export async function getJobMetricsSummary(): Promise<JobMetricsSummary> {
  const pool = getPool();
  const result = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'queued') as queued,
      COUNT(*) FILTER (WHERE status = 'running') as running,
      COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'cancelling') as cancelling,
      COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
    FROM jobs
  `);
  
  const row = result.rows[0];
  return {
    total: parseInt(row.total, 10),
    byStatus: {
      queued: parseInt(row.queued, 10),
      running: parseInt(row.running, 10),
      succeeded: parseInt(row.succeeded, 10),
      failed: parseInt(row.failed, 10),
      cancelling: parseInt(row.cancelling, 10),
      cancelled: parseInt(row.cancelled, 10),
    },
  };
}

export async function getJobPerformanceStats(): Promise<JobPerformanceStats> {
  const pool = getPool();
  
  // Get success rate
  const successRateResult = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE status IN ('succeeded', 'failed', 'cancelled')) as total_finished,
      COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded_count
    FROM jobs
    WHERE finished_at IS NOT NULL
  `);
  
  const finishedRow = successRateResult.rows[0];
  const totalFinished = parseInt(finishedRow.total_finished, 10);
  const succeededCount = parseInt(finishedRow.succeeded_count, 10);
  const successRate = totalFinished > 0 ? succeededCount / totalFinished : 0;
  
  // Get average processing time (time from started_at to finished_at)
  const processingTimeResult = await pool.query(`
    SELECT 
      AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) as avg_processing_time
    FROM jobs
    WHERE started_at IS NOT NULL 
      AND finished_at IS NOT NULL
      AND status IN ('succeeded', 'failed')
  `);
  
  const avgProcessingTime = processingTimeResult.rows[0].avg_processing_time 
    ? parseFloat(processingTimeResult.rows[0].avg_processing_time) 
    : null;
  
  // Get average queue time (time from queued_at to started_at)
  const queueTimeResult = await pool.query(`
    SELECT 
      AVG(EXTRACT(EPOCH FROM (started_at - queued_at))) as avg_queue_time
    FROM jobs
    WHERE queued_at IS NOT NULL 
      AND started_at IS NOT NULL
  `);
  
  const avgQueueTime = queueTimeResult.rows[0].avg_queue_time 
    ? parseFloat(queueTimeResult.rows[0].avg_queue_time) 
    : null;
  
  // Get retry rate (jobs with attempts > 1)
  const retryRateResult = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE attempts > 1) as retried_count,
      COUNT(*) as total_jobs
    FROM jobs
    WHERE status IN ('succeeded', 'failed', 'cancelled')
  `);
  
  const retryRow = retryRateResult.rows[0];
  const totalJobs = parseInt(retryRow.total_jobs, 10);
  const retriedCount = parseInt(retryRow.retried_count, 10);
  const retryRate = totalJobs > 0 ? retriedCount / totalJobs : 0;
  
  return {
    successRate,
    avgProcessingTime,
    avgQueueTime,
    retryRate,
  };
}

export async function getJobThroughput(): Promise<JobThroughput> {
  const pool = getPool();
  
  const result = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE finished_at >= NOW() - INTERVAL '1 hour') as last_hour,
      COUNT(*) FILTER (WHERE finished_at >= NOW() - INTERVAL '1 day') as last_day,
      COUNT(*) FILTER (WHERE finished_at >= NOW() - INTERVAL '7 days') as last_week
    FROM jobs
    WHERE finished_at IS NOT NULL
      AND status IN ('succeeded', 'failed', 'cancelled')
  `);
  
  const row = result.rows[0];
  return {
    lastHour: parseInt(row.last_hour, 10),
    lastDay: parseInt(row.last_day, 10),
    lastWeek: parseInt(row.last_week, 10),
  };
}

export async function getJobMetricsByDefinition(): Promise<DefinitionMetrics[]> {
  const pool = getPool();
  
  const result = await pool.query(`
    SELECT 
      definition_key,
      definition_version,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'queued') as queued,
      COUNT(*) FILTER (WHERE status = 'running') as running,
      COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'cancelling') as cancelling,
      COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
      COUNT(*) FILTER (WHERE status = 'succeeded' AND finished_at IS NOT NULL) as succeeded_finished,
      COUNT(*) FILTER (WHERE status IN ('succeeded', 'failed', 'cancelled') AND finished_at IS NOT NULL) as total_finished,
      AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE started_at IS NOT NULL AND finished_at IS NOT NULL AND status IN ('succeeded', 'failed')) as avg_processing_time,
      AVG(EXTRACT(EPOCH FROM (started_at - queued_at))) FILTER (WHERE queued_at IS NOT NULL AND started_at IS NOT NULL) as avg_queue_time
    FROM jobs
    GROUP BY definition_key, definition_version
    ORDER BY definition_key, definition_version
  `);
  
  return result.rows.map((row) => {
    const totalFinished = parseInt(row.total_finished, 10);
    const succeededFinished = parseInt(row.succeeded_finished, 10);
    const successRate = totalFinished > 0 ? succeededFinished / totalFinished : 0;
    
    return {
      definitionKey: row.definition_key,
      definitionVersion: row.definition_version,
      total: parseInt(row.total, 10),
      byStatus: {
        queued: parseInt(row.queued, 10),
        running: parseInt(row.running, 10),
        succeeded: parseInt(row.succeeded, 10),
        failed: parseInt(row.failed, 10),
        cancelling: parseInt(row.cancelling, 10),
        cancelled: parseInt(row.cancelled, 10),
      },
      successRate,
      avgProcessingTime: row.avg_processing_time ? parseFloat(row.avg_processing_time) : null,
      avgQueueTime: row.avg_queue_time ? parseFloat(row.avg_queue_time) : null,
    };
  });
}

export async function getJobThroughputTimeSeries(hours: number = 24): Promise<ThroughputDataPoint[]> {
  const pool = getPool();
  
  const result = await pool.query(`
    SELECT 
      DATE_TRUNC('hour', finished_at) as period,
      COUNT(*) FILTER (WHERE status = 'succeeded') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM jobs
    WHERE finished_at >= NOW() - INTERVAL '1 hour' * $1
      AND finished_at IS NOT NULL
      AND status IN ('succeeded', 'failed')
    GROUP BY DATE_TRUNC('hour', finished_at)
    ORDER BY period ASC
  `, [hours]);
  
  return result.rows.map((row) => ({
    period: row.period.toISOString(),
    completed: parseInt(row.completed, 10),
    failed: parseInt(row.failed, 10),
  }));
}

function mapRowToJob(row: any): Job {
  return {
    id: row.id,
    definitionKey: row.definition_key,
    definitionVersion: row.definition_version,
    // PostgreSQL JSONB columns are already parsed as objects by pg library
    params: row.params || {},
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

function mapRowToDlqJob(row: any): DlqJob {
  return {
    id: row.id,
    originalJobId: row.original_job_id,
    definitionKey: row.definition_key,
    definitionVersion: row.definition_version,
    params: row.params || {},
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorSummary: row.error_summary,
    idempotencyKey: row.idempotency_key,
    movedToDlqAt: row.moved_to_dlq_at,
  };
}

/**
 * Move a failed job to the dead-letter queue.
 * This should be called when a job has exceeded its max attempts.
 */
export async function moveJobToDlq(job: Job, errorSummary: string): Promise<DlqJob> {
  const pool = getPool();
  
  // Use a transaction to ensure atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Insert into DLQ
    const dlqId = uuidv4();
    const result = await client.query(
      `INSERT INTO jobs_dlq (
        id, original_job_id, definition_key, definition_version, params, priority,
        attempts, max_attempts, queued_at, started_at, finished_at, error_summary, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12)
      RETURNING *`,
      [
        dlqId,
        job.id,
        job.definitionKey,
        job.definitionVersion,
        JSON.stringify(job.params),
        job.priority,
        job.attempts,
        job.maxAttempts,
        job.queuedAt,
        job.startedAt,
        errorSummary,
        job.idempotencyKey ?? null,
      ]
    );
    
    // Delete job_events first (due to foreign key constraint)
    await client.query('DELETE FROM job_events WHERE job_id = $1', [job.id]);
    
    // Delete from main jobs table
    await client.query('DELETE FROM jobs WHERE id = $1', [job.id]);
    
    await client.query('COMMIT');
    
    return mapRowToDlqJob(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List jobs in the dead-letter queue.
 */
export async function listDlqJobs(
  definitionKey?: string,
  limit: number = 100,
  offset: number = 0
): Promise<DlqJob[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;
  
  if (definitionKey) {
    conditions.push(`definition_key = $${paramIndex}`);
    values.push(definitionKey);
    paramIndex++;
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const result = await pool.query(
    `SELECT * FROM jobs_dlq
     ${whereClause}
     ORDER BY moved_to_dlq_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...values, limit, offset]
  );
  
  return result.rows.map(mapRowToDlqJob);
}

/**
 * Get a DLQ job by ID.
 */
export async function getDlqJobById(dlqJobId: string): Promise<DlqJob | null> {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM jobs_dlq WHERE id = $1', [dlqJobId]);
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToDlqJob(result.rows[0]);
}

/**
 * Retry a DLQ job by creating a new job from it.
 */
export async function retryDlqJob(dlqJobId: string, maxAttempts?: number): Promise<Job> {
  const dlqJob = await getDlqJobById(dlqJobId);
  
  if (!dlqJob) {
    throw new Error(`DLQ job ${dlqJobId} not found`);
  }
  
  // Create a new job from the DLQ job
  const newJob = await createJob({
    definitionKey: dlqJob.definitionKey,
    definitionVersion: dlqJob.definitionVersion,
    params: dlqJob.params,
    priority: dlqJob.priority,
    maxAttempts: maxAttempts ?? dlqJob.maxAttempts,
    idempotencyKey: dlqJob.idempotencyKey ?? undefined,
  });
  
  return newJob;
}

