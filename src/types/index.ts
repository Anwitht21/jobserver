export type JobParams = Record<string, unknown>;

export interface JobContext {
  jobId: string;
  abortSignal: AbortSignal;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
  };
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

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export interface Job {
  id: string;
  definitionKey: string;
  definitionVersion: number;
  params: JobParams;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date | null;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  cancelRequestedAt: Date | null;
  workerId: string | null;
  idempotencyKey: string | null;
  errorSummary: string | null;
}

export interface JobEvent {
  id: number;
  jobId: string;
  eventType: string;
  at: Date;
  payload: Record<string, unknown> | null;
}

export interface CreateJobRequest {
  definitionKey: string;
  definitionVersion?: number;
  params?: JobParams;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
}

