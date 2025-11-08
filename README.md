# Job Server

A horizontally scalable job execution server with support for background jobs, retries, scheduling, and lifecycle hooks.

## Features

- ✅ Worker coordinator with **process isolation** - each job runs in a separate process
- ✅ Horizontal scaling support via SKIP LOCKED
- ✅ REST API: start jobs, get status, cancel jobs
- ✅ Retry logic with exponential backoff
- ✅ Idempotency support, heartbeats, orphan job recovery
- ✅ Priority system, lifecycle hooks, cron-style scheduling
- ✅ Dynamic job loading from files (auto-discovery)
- ✅ Real-time job notifications via PostgreSQL LISTEN/NOTIFY

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up database
export DATABASE_URL=postgresql://localhost:5432/jobserver
npm run migrate

# 3. Register job definitions
npm run register-definitions

# 4. Start services (in separate terminals)
npm run dev:api      # API server
npm run dev:worker  # Worker service
npm run dev:scheduler # Scheduler (optional)
```

## API Endpoints

**Jobs:**
- `POST /v1/jobs` - Create job
- `GET /v1/jobs` - List jobs (filters: `status`, `definitionKey`)
- `GET /v1/jobs/:jobId` - Get job status
- `GET /v1/jobs/:jobId/events` - Get job events
- `POST /v1/jobs/:jobId/cancel` - Cancel job

**Video Encoding:**
- `POST /v1/videos/encode` - Upload and encode video (requires FFmpeg)
- `GET /v1/videos/:jobId/status` - Get encoding status
- `GET /v1/videos/:jobId/download` - Download encoded video

**Other:**
- `GET /v1/definitions` - List job definitions
- `GET /v1/dlq` - List Dead Letter Queue jobs
- `POST /v1/dlq/:dlqJobId/retry` - Retry DLQ job
- `GET /v1/metrics` - System metrics
- `GET /v1/metrics/definitions` - Metrics by definition
- `GET /v1/metrics/throughput` - Throughput data
- `GET /v1/metrics/performance` - Performance stats

## Job Definitions

Available after `npm run register-definitions`:
- `echo@1` - Simple echo job
- `encode.video@1` - Video encoding with FFmpeg
- `compute.math@1` - Math computations (sum, product, fibonacci, prime)
- `process.data@1` - Data processing simulation
- `call.api@1` - API call simulation
- `process.batch@1` - Batch processing
- `failing@1` - Failing job for testing retries

## Creating Custom Jobs

1. **Create job file** (`jobs/my-job.ts`):
```typescript
import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
  key: 'my-job',
  version: 1,
  defaultMaxAttempts: 3,
  run: async (params, ctx) => {
    ctx.logger.info('Job started', params);
    // Your job logic here
  },
};

export default definition;
```

2. **Register in database**: `npm run register-definitions`
3. **Restart worker** - it will auto-discover the new job

**Hot-reload** (development): `WATCH_JOBS=true npm run dev:worker`

## Examples

**Create a job:**
```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"definitionKey": "echo", "definitionVersion": 1, "params": {"message": "Hello"}}'
```

**Encode video:**
```bash
curl -X POST http://localhost:3000/v1/videos/encode \
  -F "video=@video.mp4" -F "quality=1080p"
```

**Check status:**
```bash
curl http://localhost:3000/v1/jobs/{jobId}
```

## Architecture

- **API Server**: Stateless HTTP service for job lifecycle management
- **Worker Service**: Coordinator that spawns isolated processes for each job execution
- **Scheduler**: Leader-elected cron scheduler for recurring jobs
- **Database**: PostgreSQL for job state, queue, and events

### Worker Architecture

The worker uses a **coordinator pattern** with **process isolation**:

1. **Worker Coordinator** (`src/worker/index.ts`):
   - Claims jobs from the database using `SKIP LOCKED` for horizontal scaling
   - Spawns a separate child process for each job execution
   - Manages up to `MAX_CONCURRENT_EXECUTIONS` concurrent processes
   - Uses PostgreSQL `LISTEN/NOTIFY` for real-time job notifications
   - Falls back to polling if notifications are unavailable
   - Handles graceful shutdown by waiting for active processes to complete

2. **Single-Job Worker** (`src/worker/single-job-worker.ts`):
   - Runs as a separate process for each job
   - Executes one job and exits
   - Provides **complete isolation**: if a job crashes or hangs, only that process dies
   - The coordinator automatically spawns new processes for additional jobs

**Benefits:**
- **Fault isolation**: Job crashes don't affect other jobs or the coordinator
- **Resource isolation**: Each job runs in its own process with separate memory space
- **Clean shutdown**: Processes can be terminated individually without affecting others
- **Horizontal scaling**: Multiple worker coordinators can run simultaneously

## Environment Variables

**Required:**
- `DATABASE_URL` - PostgreSQL connection string

**Optional:**
- `PORT` - API server port (default: 3000)
- `WORKER_ID` - Worker identifier (default: `worker-{pid}`)
- `MAX_CONCURRENT_EXECUTIONS` - Max concurrent jobs (default: 10)
- `LEASE_DURATION_SECONDS` - Job lease duration (default: 60)
- `WATCH_JOBS` - Enable file watching for hot-reload (default: false)

See code for full list of environment variables.
