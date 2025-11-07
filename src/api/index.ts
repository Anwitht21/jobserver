import 'dotenv/config';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { createJob, getJobById, listJobs, requestCancellation, getJobEvents } from '../db/jobs';
import { CreateJobRequest } from '../types';
import { runMigrations } from '../db/migrations';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const createJobSchema = z.object({
  definitionKey: z.string(),
  definitionVersion: z.number().optional(),
  params: z.record(z.unknown()).optional(),
  priority: z.number().optional(),
  maxAttempts: z.number().optional(),
  idempotencyKey: z.string().optional(),
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
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /v1/jobs/:jobId
app.get('/v1/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
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
    const limit = parseInt(req.query.limit as string || '100', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);
    
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
