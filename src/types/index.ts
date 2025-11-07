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

export interface DlqJob {
  id: string;
  originalJobId: string;
  definitionKey: string;
  definitionVersion: number;
  params: JobParams;
  priority: number;
  attempts: number;
  maxAttempts: number;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date;
  errorSummary: string;
  idempotencyKey: string | null;
  movedToDlqAt: Date;
}

export interface JobStatusCounts {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelling: number;
  cancelled: number;
}

export interface JobMetricsSummary {
  total: number;
  byStatus: JobStatusCounts;
}

export interface JobPerformanceStats {
  successRate: number;
  avgProcessingTime: number | null;
  avgQueueTime: number | null;
  retryRate: number;
}

export interface JobThroughput {
  lastHour: number;
  lastDay: number;
  lastWeek: number;
}

export interface DefinitionMetrics {
  definitionKey: string;
  definitionVersion: number;
  total: number;
  byStatus: JobStatusCounts;
  successRate: number;
  avgProcessingTime: number | null;
  avgQueueTime: number | null;
}

export interface ThroughputDataPoint {
  period: string;
  completed: number;
  failed: number;
}

