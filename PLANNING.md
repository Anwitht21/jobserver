## Job Server Take‑Home — Planning & Architecture

### Prompt (for context)

> Job Server Take Home
>
> Estimated time: 4–6 hours
>
> Many workflows do not fit a traditional API endpoint structure. We have long‑running tasks executed in the background. Existing solutions like Temporal do not fit because workflows are non‑deterministic and do not fit into sandboxed structures. Build a worker that executes standardized job definitions.
>
> Requirements
>
> Core
> - Worker server that executes jobs
> - Define a function that will be executed as a job
> - Instances of jobs are isolated from each other
> - Support horizontal scaling
> - API: start jobs, get status, cancel jobs
>
> Nice to haves
> - Side effects for lifecycle events (On Start, On End, On Fail, On Succeed)
> - Cron‑style scheduling
> - Priority system
>
> Avoid
> - Big shortcuts like Temporal or Vercel Workflows SDK (inspiration is fine)

### Goals and non‑goals

- Goals: background job execution with isolation, REST API for lifecycle, horizontally scalable workers, robust status tracking, cancellation, retries.
- Non‑goals: full workflow engine, visual DAG builder, external queue dependency beyond a single DB (optional Redis deferred).

## High‑level architecture

- API Server
  - Stateless HTTP service exposing job lifecycle endpoints.
  - Writes and reads state from a relational DB (Postgres). Optionally emits lifecycle events.

- Persistence (Postgres)
  - Canonical store for jobs, schedules, events, and worker leases.
  - Queue abstraction implemented via SELECT … FOR UPDATE SKIP LOCKED to claim work safely across processes.

- Worker Service
  - Runs N concurrent executors per instance.
  - Claims queued jobs atomically, executes in an isolated child process, heartbeats to maintain a lease, handles retries, and emits lifecycle events.

- Scheduler (optional nice‑to‑have)
  - Single active leader (Postgres advisory lock) computes cron schedules and enqueues jobs.

- Event Bus / Hooks (optional nice‑to‑have)
  - Internal pub/sub or webhook dispatch for OnStart/OnSuccess/OnFail/OnEnd.

### Isolation strategy

- Each job executes in a separate OS process (subprocess) with a well‑defined interface (stdin/stdout or IPC), memory limits (ulimits), and a cancellable signal.
- Cooperative cancellation via an AbortSignal passed to the job runner; after grace period, forcefully kill the child process.

### Horizontal scaling

- Multiple worker instances race to claim jobs using SKIP LOCKED and per‑job leases with periodic heartbeats.
- If a worker dies (lease expires), another worker can reclaim the job.

## Job model and lifecycle

### Core entities

- JobDefinition
  - key (string), version (int), metadata (timeout, defaultMaxAttempts, concurrencyLimitPerKey)
  - run(params, context): executes the job logic
  - optional hooks: onStart, onSuccess, onFail, onEnd

- Job (runtime instance)
  - id (uuid), definitionKey, params (JSON), status, priority, attempts, maxAttempts
  - scheduledAt, queuedAt, startedAt, finishedAt, heartbeatAt, leaseExpiresAt
  - workerId, errorSummary, cancelRequestedAt, idempotencyKey (optional)

### Status state machine

- queued → running → succeeded
- queued → running → failed (retry if attempts < maxAttempts with backoff)
- queued → cancelled
- running → cancelling → cancelled (cooperative, then kill)
- running → orphaned (lease expired) → queued (reclaimed)

### Retry and backoff

- Exponential backoff with jitter: delay = min(maxBackoff, base * 2^attempt + randomJitter).

### Idempotency

- Optional idempotencyKey on start; if present, de‑dupe an in‑flight or completed job for the same key and definition.

## Data model (Postgres)

```sql
-- Minimal viable schema
create table job_definitions (
  key text not null,
  version int not null default 1,
  default_max_attempts int not null default 3,
  timeout_seconds int not null default 3600,
  concurrency_limit int not null default 0, -- 0 means unlimited per definition
  primary key (key, version)
);

create type job_status as enum (
  'queued','running','succeeded','failed','cancelling','cancelled'
);

create table jobs (
  id uuid primary key,
  definition_key text not null,
  definition_version int not null default 1,
  params jsonb not null default '{}',
  status job_status not null default 'queued',
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  scheduled_at timestamptz,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  worker_id text,
  idempotency_key text,
  error_summary text,
  constraint fk_def foreign key (definition_key, definition_version)
    references job_definitions(key, version)
);

create index idx_jobs_status_priority on jobs(status, priority desc, queued_at asc);
create index idx_jobs_scheduled on jobs(scheduled_at) where status = 'queued';
create unique index if not exists uq_jobs_idemp on jobs(idempotency_key, definition_key, definition_version)
  where idempotency_key is not null;

create table job_events (
  id bigserial primary key,
  job_id uuid not null,
  event_type text not null, -- started, succeeded, failed, cancelled, heartbeat
  at timestamptz not null default now(),
  payload jsonb,
  foreign key (job_id) references jobs(id)
);

create table schedules (
  id uuid primary key,
  definition_key text not null,
  definition_version int not null default 1,
  cron text not null,
  params jsonb not null default '{}',
  priority int not null default 0,
  enabled boolean not null default true,
  last_enqueued_at timestamptz
);
```

## Public API (HTTP)

Base path: `/v1`

- POST `/v1/jobs`
  - Start a job instance.
  - Request:

```json
{
  "definitionKey": "transcode.video",
  "definitionVersion": 1,
  "params": {"url": "https://example.com/video.mp4"},
  "priority": 5,
  "maxAttempts": 3,
  "idempotencyKey": "upload-123"
}
```

  - Response:

```json
{
  "jobId": "c3f8d6a0-9f8c-4b22-8b1c-5b0e2a9dc1e2",
  "status": "queued"
}
```

- GET `/v1/jobs/{jobId}`
  - Returns job status and metadata.

```json
{
  "jobId": "c3f8d6a0-9f8c-4b22-8b1c-5b0e2a9dc1e2",
  "definitionKey": "transcode.video",
  "status": "running",
  "attempts": 1,
  "maxAttempts": 3,
  "priority": 5,
  "startedAt": "2025-11-07T10:15:00Z",
  "heartbeatAt": "2025-11-07T10:15:30Z",
  "workerId": "worker-2"
}
```

- POST `/v1/jobs/{jobId}/cancel`
  - Requests cooperative cancellation. Returns 202 if accepted.

- GET `/v1/jobs?status=queued|running|succeeded|failed|cancelled&definitionKey=...`
  - Paged listing.

- GET `/v1/jobs/{jobId}/events`
  - Lifecycle events stream for auditing/UX.

### OpenAPI sketch

```yaml
openapi: 3.0.3
info:
  title: Job Server API
  version: 0.1.0
paths:
  /v1/jobs:
    post:
      summary: Start a job
  /v1/jobs/{jobId}:
    get:
      summary: Get job
  /v1/jobs/{jobId}/cancel:
    post:
      summary: Cancel job
```

## Worker design

- Registry of job definitions loaded at process start: a map of `definitionKey@version` → `{ run, onStart, onSuccess, onFail, onEnd }`.
- Execution loop (each worker):
  1. Claim a job: `select id from jobs where status='queued' and (scheduled_at is null or scheduled_at <= now()) order by priority desc, queued_at asc for update skip locked limit 1;`
  2. Update to running, set `worker_id`, `lease_expires_at = now()+lease`, `started_at`, record event started.
  3. Spawn child process with the job definition code and params. Provide cancellation token and heartbeat channel.
  4. Heartbeat every N seconds: extend lease; update `heartbeat_at` and `lease_expires_at`.
  5. On success: set status succeeded, `finished_at`, record event, call onSuccess/onEnd.
  6. On failure: increment attempts; if attempts < max, compute backoff and set status queued scheduledAt=now()+backoff; else set status failed and call onFail/onEnd.
  7. If cancellation requested: signal child; after grace timeout, kill; mark cancelled.

### Job function interface (language‑agnostic)

```text
run(params: JSON, context: { jobId, abortSignal, logger, emitEvent }) => Promise<void>

onStart?(ctx)
onSuccess?(ctx)
onFail?(ctx)
onEnd?(ctx)
```

## Scheduling (cron)

- Store schedules in `schedules` table with a standard 5‑field cron expression and timezone.
- Scheduler service runs every minute. It takes a Postgres advisory lock `pg_try_advisory_lock(some_key)` to ensure a single leader; computes due triggers, inserts jobs.
- Handle catch‑up configuration (enqueuing missed runs) via per‑schedule flag.

## Priority and concurrency

- Priority: integer; higher values are dequeued first. Composite ordering by priority desc, then queuedAt asc.
- Per‑definition concurrency cap: if `concurrency_limit > 0`, only run up to that many jobs with status running per definition across cluster. Enforced by checking running count before claim.
- Worker local concurrency: configurable `MAX_CONCURRENT_EXECUTIONS` per process.

## Cancellation

- API sets `cancel_requested_at`. Worker checks this on heartbeat and forwards to job via AbortSignal. After `CANCEL_GRACE_MS`, forcibly kill the process and mark cancelled.

## Lifecycle events and side effects (nice‑to‑have)

- Emit `job_events` rows and optionally publish to a lightweight internal bus.
- Webhook subscriptions: `onStart|onSuccess|onFail|onEnd` callbacks with signed HMAC and retry policy.

## Observability

- Structured logs per job with `jobId` correlation.
- Metrics: queue depth, running count, successes/failures, durations, retries, lease expirations.
- Tracing: span per job execution, child spans for external calls (optional).

## Security and isolation

- Validate all inputs; schema validation for params.
- Limit child process resources; sanitize environment.
- Sign lifecycle webhooks; redact secrets in logs.

## Implementation milestones

1) Minimal data model and migrations (0.5h)
- Tables: `job_definitions`, `jobs`, `job_events`.

2) Worker that executes a single registered job function (1.0h)
- Claim via SKIP LOCKED, run in child process, mark succeeded/failed.

3) API endpoints: start, get status, cancel (1.0h)
- POST /jobs, GET /jobs/{id}, POST /jobs/{id}/cancel.

4) Retries and backoff, idempotency key (0.5h)
- Store attempts, compute delay with jitter; upsert on idempotencyKey.

5) Heartbeats, leases, orphan recovery (0.5h)
- Update lease and reclaim expired jobs.

6) Priority support and listing (0.5h)
- Prioritized claim; GET /jobs listing filter/sort.

7) Stretch: lifecycle hooks + events (0.5h)
- Insert `job_events`, basic webhook dispatch.

8) Stretch: cron scheduler (0.5–1.0h)
- Advisory‑lock leader; enqueue due schedules.

## Risks and mitigations

- Long‑running external calls may ignore cancellation → enforce hard kill after grace.
- Hot partitions on a single definition key with high concurrency → per‑definition limit.
- Clock drift across nodes → prefer DB NOW() for schedule evaluation.

## Appendix: TypeScript‑style interfaces (illustrative)

```ts
export type JobParams = Record<string, unknown>;

export interface JobContext {
  jobId: string;
  abortSignal: AbortSignal;
  logger: { info: (m: unknown) => void; error: (m: unknown) => void };
  emitEvent: (type: string, payload?: unknown) => Promise<void>;
}

export interface JobDefinition {
  key: string;
  version?: number;
  timeoutSeconds?: number;
  defaultMaxAttempts?: number;
  concurrencyLimit?: number;
  run: (params: JobParams, ctx: JobContext) => Promise<void>;
  onStart?: (ctx: JobContext) => Promise<void>;
  onSuccess?: (ctx: JobContext) => Promise<void>;
  onFail?: (ctx: JobContext & { error: unknown }) => Promise<void>;
  onEnd?: (ctx: JobContext) => Promise<void>;
}
```


