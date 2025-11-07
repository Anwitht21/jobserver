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

4. Register job definitions:
```bash
npm run register-definitions
```

This registers the following job definitions:
- `echo@1` - Simple echo job for testing
- `failing@1` - Job that always fails (for testing retries)
- `encode.video@1` - Real video encoding with FFmpeg
- `compute.math@1` - CPU-intensive math computations
- `process.data@1` - Data processing simulation
- `call.api@1` - API call simulation
- `process.batch@1` - Batch processing

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

**Query parameters**:
- `status` (optional): Filter by status (`queued`, `running`, `succeeded`, `failed`, `cancelled`)
- `definitionKey` (optional): Filter by job definition key

**Example**:
```bash
curl "http://localhost:3000/v1/jobs?status=running&definitionKey=encode.video"
```

### GET /v1/jobs/:jobId/events
Get lifecycle events for a job.

**Example**:
```bash
curl http://localhost:3000/v1/jobs/{jobId}/events
```

### GET /v1/definitions
List all registered job definitions.

**Example**:
```bash
curl http://localhost:3000/v1/definitions
```

**Response**:
```json
{
  "definitions": [
    {
      "key": "encode.video",
      "version": 1,
      "defaultMaxAttempts": 2,
      "timeoutSeconds": 7200,
      "concurrencyLimit": 3
    }
  ]
}
```

## Video Encoding Endpoints

### POST /v1/videos/encode
Upload a video file and create an encoding job. Uses FFmpeg for real video encoding.

**Prerequisites**: Install FFmpeg (`brew install ffmpeg` on macOS, `sudo apt-get install ffmpeg` on Ubuntu/Debian)

**Example**:
```bash
curl -X POST http://localhost:3000/v1/videos/encode \
  -F "video=@/path/to/your/video.mp4" \
  -F "format=mp4" \
  -F "quality=1080p" \
  -F "priority=10"
```

**Response**:
```json
{
  "jobId": "abc123-def456-...",
  "status": "queued",
  "message": "Video encoding job created",
  "inputFile": "1234567890-video.mp4"
}
```

**Quality options**: `720p`, `1080p`, `4k`

### GET /v1/videos/:jobId/status
Get video encoding status with output file information.

**Example**:
```bash
curl http://localhost:3000/v1/videos/{jobId}/status
```

**Response** (when completed):
```json
{
  "jobId": "abc123-def456-...",
  "status": "succeeded",
  "definitionKey": "encode.video",
  "outputPath": "outputs/1234567890-video-1080p.mp4",
  "outputFilename": "1234567890-video-1080p.mp4",
  "downloadUrl": "/v1/videos/abc123-def456-.../download"
}
```

### GET /v1/videos/:jobId/download
Download the encoded video file.

**Example**:
```bash
curl -o encoded-video.mp4 http://localhost:3000/v1/videos/{jobId}/download
```

## Dead Letter Queue (DLQ) Endpoints

Jobs that exceed their maximum attempts are moved to the Dead Letter Queue for manual inspection and retry.

### GET /v1/dlq
List jobs in the Dead Letter Queue.

**Query parameters**:
- `definitionKey` (optional): Filter by job definition key
- `limit` (optional): Max results (default: 100, max: 1000)
- `offset` (optional): Pagination offset (default: 0)

**Example**:
```bash
curl "http://localhost:3000/v1/dlq?limit=50"
```

### GET /v1/dlq/:dlqJobId
Get details of a specific DLQ job.

**Example**:
```bash
curl http://localhost:3000/v1/dlq/{dlqJobId}
```

### POST /v1/dlq/:dlqJobId/retry
Retry a job from the Dead Letter Queue.

**Example**:
```bash
curl -X POST http://localhost:3000/v1/dlq/{dlqJobId}/retry \
  -H "Content-Type: application/json" \
  -d '{"maxAttempts": 5}'
```

## Metrics Endpoints

### GET /v1/metrics
Get overall system metrics including summary, performance stats, and throughput.

Response:
```json
{
  "summary": {
    "total": 1000,
    "byStatus": {
      "queued": 150,
      "running": 50,
      "succeeded": 700,
      "failed": 80,
      "cancelling": 5,
      "cancelled": 15
    }
  },
  "performance": {
    "successRate": 0.875,
    "avgProcessingTime": 45.2,
    "avgQueueTime": 12.5,
    "retryRate": 0.15
  },
  "throughput": {
    "lastHour": 120,
    "lastDay": 2400,
    "lastWeek": 16800
  }
}
```

Query parameters:
- `ttl` (optional): Cache TTL in seconds (default: 30)

### GET /v1/metrics/definitions
Get metrics grouped by job definition.

Response:
```json
{
  "definitions": [
    {
      "definitionKey": "echo",
      "definitionVersion": 1,
      "total": 500,
      "byStatus": {
        "queued": 10,
        "running": 5,
        "succeeded": 450,
        "failed": 30,
        "cancelling": 2,
        "cancelled": 3
      },
      "successRate": 0.94,
      "avgProcessingTime": 2.5,
      "avgQueueTime": 0.8
    }
  ]
}
```

Query parameters:
- `ttl` (optional): Cache TTL in seconds (default: 30)

### GET /v1/metrics/throughput
Get time-series throughput data showing completed and failed jobs over time.

Response:
```json
{
  "data": [
    {
      "period": "2024-01-01T10:00:00.000Z",
      "completed": 50,
      "failed": 5
    },
    {
      "period": "2024-01-01T11:00:00.000Z",
      "completed": 45,
      "failed": 3
    }
  ]
}
```

Query parameters:
- `hours` (optional): Number of hours to look back (1-168, default: 24)
- `ttl` (optional): Cache TTL in seconds (default: 30)

### GET /v1/metrics/performance
Get performance statistics including success rate, processing times, and retry rates.

Response:
```json
{
  "successRate": 0.875,
  "avgProcessingTime": 45.2,
  "avgQueueTime": 12.5,
  "retryRate": 0.15
}
```

Query parameters:
- `ttl` (optional): Cache TTL in seconds (default: 30)

## Available Job Definitions

After running `npm run register-definitions`, the following job definitions are available:

### 1. `echo@1` - Simple Echo Job
Quick test job that logs messages (~1 second).

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "echo",
    "definitionVersion": 1,
    "params": {"message": "Hello World"}
  }'
```

### 2. `encode.video@1` - Video Encoding (FFmpeg)
**Real video encoding** using FFmpeg. Upload a video file and get an encoded version.

**Prerequisites**: Install FFmpeg (`brew install ffmpeg` on macOS)

```bash
curl -X POST http://localhost:3000/v1/videos/encode \
  -F "video=@/path/to/video.mp4" \
  -F "quality=1080p" \
  -F "priority=10"
```

**Quality options**: `720p`, `1080p`, `4k`

### 3. `compute.math@1` - Math Computation
CPU-intensive mathematical calculations.

**Operations**: `sum`, `product`, `fibonacci`, `prime`

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "compute.math",
    "definitionVersion": 1,
    "params": {
      "operation": "fibonacci",
      "numbers": [35]
    }
  }'
```

### 4. `process.data@1` - Data Processing
Simulates I/O-intensive data processing pipeline.

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "process.data",
    "definitionVersion": 1,
    "params": {
      "dataset": "sales-2024",
      "operation": "aggregate"
    }
  }'
```

### 5. `call.api@1` - API Call Simulation
Simulates external API calls with network delays.

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "call.api",
    "definitionVersion": 1,
    "params": {
      "endpoint": "https://api.example.com/users",
      "method": "GET"
    }
  }'
```

### 6. `process.batch@1` - Batch Processing
Processes multiple items in batches with progress tracking.

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "process.batch",
    "definitionVersion": 1,
    "params": {
      "items": ["item1", "item2", "item3"],
      "batchSize": 5
    }
  }'
```

### 7. `failing@1` - Failing Job (for testing)
Always fails - useful for testing retry logic.

```bash
curl -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "failing",
    "definitionVersion": 1,
    "params": {}
  }'
```

## Creating Custom Job Definitions

Jobs are registered with the worker registry. Example:

```typescript
import { jobRegistry } from './worker/registry';

jobRegistry.register({
  key: 'my-job',
  version: 1,
  defaultMaxAttempts: 3,
  timeoutSeconds: 3600,
  concurrencyLimit: 5, // Max 5 concurrent executions
  run: async (params, ctx) => {
    ctx.logger.info('Job started', params);
    // Your job logic here
    if (ctx.abortSignal.aborted) {
      throw new Error('Job cancelled');
    }
    await ctx.emitEvent('progress', { step: 'processing' });
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

Then register it in the database:
```bash
npm run register-definitions
```

## Architecture

- **API Server**: Stateless HTTP service for job lifecycle management
- **Worker Service**: Claims and executes jobs with isolation
- **Scheduler**: Leader-elected cron scheduler for recurring jobs
- **Database**: PostgreSQL for job state, queue, and events

## Quick Examples

### Complete Video Encoding Workflow
```bash
# 1. Upload and encode video
JOB_ID=$(curl -s -X POST http://localhost:3000/v1/videos/encode \
  -F "video=@/path/to/video.mp4" \
  -F "quality=1080p" \
  -F "priority=10" | jq -r '.jobId')

# 2. Check status
curl http://localhost:3000/v1/videos/$JOB_ID/status | jq

# 3. Monitor progress
curl http://localhost:3000/v1/jobs/$JOB_ID/events | jq

# 4. Download when complete
curl -o encoded-video.mp4 http://localhost:3000/v1/videos/$JOB_ID/download
```

### Start and Monitor a Job
```bash
# 1. Create job
JOB_ID=$(curl -s -X POST http://localhost:3000/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "definitionKey": "compute.math",
    "definitionVersion": 1,
    "params": {"operation": "fibonacci", "numbers": [35]},
    "priority": 10
  }' | jq -r '.jobId')

# 2. Check status
curl http://localhost:3000/v1/jobs/$JOB_ID | jq

# 3. View events
curl http://localhost:3000/v1/jobs/$JOB_ID/events | jq
```

### List All Jobs
```bash
# List all jobs
curl http://localhost:3000/v1/jobs | jq

# Filter by status
curl "http://localhost:3000/v1/jobs?status=running" | jq

# Filter by definition
curl "http://localhost:3000/v1/jobs?definitionKey=encode.video" | jq
```

### Cancel a Running Job
```bash
curl -X POST http://localhost:3000/v1/jobs/{jobId}/cancel
```

### View Metrics
```bash
# Overall metrics
curl http://localhost:3000/v1/metrics | jq

# Metrics by definition
curl http://localhost:3000/v1/metrics/definitions | jq

# Throughput over time
curl "http://localhost:3000/v1/metrics/throughput?hours=24" | jq
```

For more detailed examples, see [**CURL_EXAMPLES.md**](./CURL_EXAMPLES.md).

## Documentation

- 🚀 [**QUICK_REFERENCE.md**](./QUICK_REFERENCE.md) - One-page cheat sheet for quick lookup
- 📖 [**SYSTEM_DESIGN.md**](./SYSTEM_DESIGN.md) - Comprehensive system design documentation
- 📊 [**ARCHITECTURE.md**](./ARCHITECTURE.md) - Visual architecture diagrams (Mermaid)
- ⭐ [**NEW_FEATURES.md**](./NEW_FEATURES.md) - New features and enhancements guide
- 📋 [**JOB_DEFINITIONS.md**](./JOB_DEFINITIONS.md) - Available job definitions guide
- 🎬 [**CURL_EXAMPLES.md**](./CURL_EXAMPLES.md) - Complete curl examples for all job types
- 📝 [**PLANNING.md**](./PLANNING.md) - Original planning and architecture notes

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (required)
- `PORT`: API server port (default: 3000)
- `WORKER_ID`: Unique worker identifier (default: `worker-{pid}`)
- `MAX_CONCURRENT_EXECUTIONS`: Max concurrent jobs per worker (default: 10)
- `LEASE_DURATION_SECONDS`: Job lease duration (default: 60)
- `HEARTBEAT_INTERVAL_SECONDS`: Heartbeat interval (default: 10)
- `CANCEL_GRACE_MS`: Grace period for cancellation (default: 5000)
- `POLL_INTERVAL_MS`: Fallback polling interval (default: 60000)
- `DB_POOL_MAX`: Database connection pool max size (default: 20)
- `DB_POOL_IDLE_TIMEOUT_MS`: Database pool idle timeout (default: 30000)
- `DB_POOL_CONNECTION_TIMEOUT_MS`: Database connection timeout (default: 2000)
- `BACKOFF_BASE_SECONDS`: Retry backoff base seconds (default: 1)
- `BACKOFF_MAX_SECONDS`: Retry backoff max seconds (default: 3600)
- `BACKOFF_JITTER_PERCENT`: Retry backoff jitter percentage (default: 0.3)
- `CANCEL_CHECK_INTERVAL_MS`: Cancellation check interval (default: 1000)
- `METRICS_CACHE_TTL_MS`: Metrics cache default TTL (default: 30000)
