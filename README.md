# Job Server

A horizontally scalable job execution server with support for background jobs, retries, scheduling, and lifecycle hooks.

## Features

- ✅ Worker server that executes jobs
- ✅ Job definitions with isolated execution
- ✅ Horizontal scaling support via SKIP LOCKED
- ✅ REST API: start jobs, get status, cancel jobs
- ✅ Retry logic with exponential backoff
- ✅ Idempotency support
- ✅ Heartbeats and lease management
- ✅ Orphan job recovery
- ✅ Priority system
- ✅ Lifecycle events and hooks
- ✅ Cron-style scheduling

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up your database (PostgreSQL):
```bash
# Set DATABASE_URL environment variable or create .env file
export DATABASE_URL=postgresql://localhost:5432/jobserver
```

3. Run migrations:
```bash
npm run migrate
```

## Running

### API Server
```bash
npm run dev:api
```

### Worker
```bash
npm run dev:worker
```

### Scheduler (optional)
```bash
npm run dev:scheduler
```

## API Endpoints

### POST /v1/jobs
Start a new job instance.

Request:
```json
{
  "definitionKey": "echo",
  "definitionVersion": 1,
  "params": {"message": "Hello"},
  "priority": 5,
  "maxAttempts": 3,
  "idempotencyKey": "unique-key-123"
}
```

### GET /v1/jobs/:jobId
Get job status and metadata.

### POST /v1/jobs/:jobId/cancel
Request cancellation of a running job.

### GET /v1/jobs
List jobs with optional filters (status, definitionKey).

### GET /v1/jobs/:jobId/events
Get lifecycle events for a job.

## Job Definitions

Jobs are registered with the worker registry. Example:

```typescript
import { jobRegistry } from './worker/registry';

jobRegistry.register({
  key: 'my-job',
  version: 1,
  defaultMaxAttempts: 3,
  timeoutSeconds: 3600,
  run: async (params, ctx) => {
    ctx.logger.info('Job started', params);
    // Your job logic here
    if (ctx.abortSignal.aborted) {
      throw new Error('Job cancelled');
    }
    ctx.logger.info('Job completed');
  },
  onStart: async (ctx) => {
    // Optional: called when job starts
  },
  onSuccess: async (ctx) => {
    // Optional: called on success
  },
  onFail: async (ctx) => {
    // Optional: called on failure
  },
  onEnd: async (ctx) => {
    // Optional: called when job ends (success or failure)
  },
});
```

## Architecture

- **API Server**: Stateless HTTP service for job lifecycle management
- **Worker Service**: Claims and executes jobs with isolation
- **Scheduler**: Leader-elected cron scheduler for recurring jobs
- **Database**: PostgreSQL for job state, queue, and events

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: API server port (default: 3000)
- `WORKER_ID`: Unique worker identifier
- `MAX_CONCURRENT_EXECUTIONS`: Max concurrent jobs per worker (default: 10)
- `LEASE_DURATION_SECONDS`: Job lease duration (default: 60)
- `HEARTBEAT_INTERVAL_SECONDS`: Heartbeat interval (default: 10)
- `CANCEL_GRACE_MS`: Grace period for cancellation (default: 5000)
