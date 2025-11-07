import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import { createJob, getJobById, listJobs, requestCancellation, getJobEvents, listDlqJobs, getDlqJobById, retryDlqJob } from '../db/jobs';
import { CreateJobRequest } from '../types';
import { runMigrations } from '../db/migrations';
import { metricsCache } from '../utils/metrics-cache';

const app = express();

// Enable CORS for frontend access
app.use(cors({
  origin: [
    'http://localhost:3001', // Next.js dev server default
    'http://localhost:3002', // Next.js dev server alternative
    'http://localhost:3000', // Same origin
  ],
  credentials: true,
}));

app.use(express.json());

const PORT = process.env.PORT || 3000;

const createJobSchema = z.object({
  definitionKey: z.string().min(1).max(255),
  definitionVersion: z.number().int().positive().optional(),
  params: z.record(z.unknown()).optional(),
  priority: z.number().int().min(-2147483648).max(2147483647).optional(),
  maxAttempts: z.number().int().positive().max(1000).optional(),
  idempotencyKey: z.string().max(255).optional(),
});

// POST /v1/jobs
app.post('/v1/jobs', async (req: Request, res: Response) => {
  try {
    const validated = createJobSchema.parse(req.body);
    const job = await createJob(validated as CreateJobRequest);
    
    res.status(201).json({
      jobId: job.id,
      status: job.status,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    // Log the full error for debugging
    console.error('Error creating job:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// GET /v1/jobs/:jobId
app.get('/v1/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format' });
      return;
    }
    
    const job = await getJobById(jobId);
    
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    
    res.json({
      jobId: job.id,
      definitionKey: job.definitionKey,
      definitionVersion: job.definitionVersion,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      priority: job.priority,
      startedAt: job.startedAt?.toISOString() || null,
      finishedAt: job.finishedAt?.toISOString() || null,
      heartbeatAt: job.heartbeatAt?.toISOString() || null,
      workerId: job.workerId,
      errorSummary: job.errorSummary,
    });
  } catch (error) {
    console.error('Error getting job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /v1/jobs/:jobId/cancel
app.post('/v1/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format' });
      return;
    }
    
    const job = await getJobById(jobId);
    
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      res.status(400).json({ error: `Job is already ${job.status}` });
      return;
    }
    
    await requestCancellation(jobId);
    res.status(202).json({ message: 'Cancellation requested' });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/jobs
app.get('/v1/jobs', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const definitionKey = req.query.definitionKey as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '100', 10), 1000); // Max 1000
    const offset = Math.max(parseInt(req.query.offset as string || '0', 10), 0); // Min 0
    
    // Validate status if provided
    const validStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }
    
    const jobs = await listJobs(status as any, definitionKey, limit, offset);
    
    res.json({
      jobs: jobs.map(job => ({
        jobId: job.id,
        definitionKey: job.definitionKey,
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() || null,
        finishedAt: job.finishedAt?.toISOString() || null,
      })),
      total: jobs.length,
    });
  } catch (error) {
    console.error('Error listing jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/jobs/:jobId/events
app.get('/v1/jobs/:jobId/events', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format' });
      return;
    }
    
    const job = await getJobById(jobId);
    
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    
    const events = await getJobEvents(jobId);
    
    res.json({
      jobId,
      events: events.map(event => ({
        id: event.id,
        eventType: event.eventType,
        at: event.at.toISOString(),
        payload: event.payload,
      })),
    });
  } catch (error) {
    console.error('Error getting job events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/metrics
app.get('/v1/metrics', async (req: Request, res: Response) => {
  try {
    const ttl = req.query.ttl ? parseInt(req.query.ttl as string, 10) * 1000 : undefined;
    
    const [summary, performance, throughput] = await Promise.all([
      metricsCache.getMetricsSummary(ttl),
      metricsCache.getPerformanceStats(ttl),
      metricsCache.getThroughput(ttl),
    ]);
    
    res.json({
      summary,
      performance,
      throughput,
    });
  } catch (error) {
    console.error('Error getting metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/metrics/definitions
app.get('/v1/metrics/definitions', async (req: Request, res: Response) => {
  try {
    const ttl = req.query.ttl ? parseInt(req.query.ttl as string, 10) * 1000 : undefined;
    const definitions = await metricsCache.getMetricsByDefinition(ttl);
    
    res.json({
      definitions,
    });
  } catch (error) {
    console.error('Error getting definition metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/metrics/throughput
app.get('/v1/metrics/throughput', async (req: Request, res: Response) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 24;
    const ttl = req.query.ttl ? parseInt(req.query.ttl as string, 10) * 1000 : undefined;
    
    if (hours < 1 || hours > 168) {
      res.status(400).json({ error: 'Hours must be between 1 and 168 (7 days)' });
      return;
    }
    
    const data = await metricsCache.getThroughputTimeSeries(hours, ttl);
    
    res.json({
      data,
    });
  } catch (error) {
    console.error('Error getting throughput metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/metrics/performance
app.get('/v1/metrics/performance', async (req: Request, res: Response) => {
  try {
    const ttl = req.query.ttl ? parseInt(req.query.ttl as string, 10) * 1000 : undefined;
    const performance = await metricsCache.getPerformanceStats(ttl);
    
    res.json(performance);
  } catch (error) {
    console.error('Error getting performance metrics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/dlq
app.get('/v1/dlq', async (req: Request, res: Response) => {
  try {
    const definitionKey = req.query.definitionKey as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '100', 10), 1000); // Max 1000
    const offset = Math.max(parseInt(req.query.offset as string || '0', 10), 0); // Min 0
    
    const dlqJobs = await listDlqJobs(definitionKey, limit, offset);
    
    res.json({
      jobs: dlqJobs.map(job => ({
        dlqJobId: job.id,
        originalJobId: job.originalJobId,
        definitionKey: job.definitionKey,
        definitionVersion: job.definitionVersion,
        priority: job.priority,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        queuedAt: job.queuedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() || null,
        finishedAt: job.finishedAt.toISOString(),
        errorSummary: job.errorSummary,
        movedToDlqAt: job.movedToDlqAt.toISOString(),
      })),
      total: dlqJobs.length,
    });
  } catch (error) {
    console.error('Error listing DLQ jobs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/dlq/:dlqJobId
app.get('/v1/dlq/:dlqJobId', async (req: Request, res: Response) => {
  try {
    const { dlqJobId } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(dlqJobId)) {
      res.status(400).json({ error: 'Invalid DLQ job ID format' });
      return;
    }
    
    const dlqJob = await getDlqJobById(dlqJobId);
    
    if (!dlqJob) {
      res.status(404).json({ error: 'DLQ job not found' });
      return;
    }
    
    res.json({
      dlqJobId: dlqJob.id,
      originalJobId: dlqJob.originalJobId,
      definitionKey: dlqJob.definitionKey,
      definitionVersion: dlqJob.definitionVersion,
      params: dlqJob.params,
      priority: dlqJob.priority,
      attempts: dlqJob.attempts,
      maxAttempts: dlqJob.maxAttempts,
      queuedAt: dlqJob.queuedAt.toISOString(),
      startedAt: dlqJob.startedAt?.toISOString() || null,
      finishedAt: dlqJob.finishedAt.toISOString(),
      errorSummary: dlqJob.errorSummary,
      idempotencyKey: dlqJob.idempotencyKey,
      movedToDlqAt: dlqJob.movedToDlqAt.toISOString(),
    });
  } catch (error) {
    console.error('Error getting DLQ job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /v1/dlq/:dlqJobId/retry
app.post('/v1/dlq/:dlqJobId/retry', async (req: Request, res: Response) => {
  try {
    const { dlqJobId } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(dlqJobId)) {
      res.status(400).json({ error: 'Invalid DLQ job ID format' });
      return;
    }
    
    const maxAttempts = req.body.maxAttempts 
      ? Math.max(1, Math.min(parseInt(req.body.maxAttempts, 10), 1000)) // Clamp between 1 and 1000
      : undefined;
    
    const newJob = await retryDlqJob(dlqJobId, maxAttempts);
    
    res.status(201).json({
      jobId: newJob.id,
      status: newJob.status,
      message: 'Job retried from DLQ',
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('Error retrying DLQ job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export async function startApiServer(): Promise<void> {
  // Run migrations on startup
  await runMigrations();
  
  app.listen(PORT, () => {
    console.log(`API server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  startApiServer().catch((error) => {
    console.error('Failed to start API server:', error);
    process.exit(1);
  });
}
