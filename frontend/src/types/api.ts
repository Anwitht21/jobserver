// API Types for Job Server Frontend

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled';

export interface Job {
  jobId: string;
  definitionKey: string;
  definitionVersion: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  priority: number;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  workerId: string | null;
  errorSummary: string | null;
  queuedAt?: string;
}

export interface JobEvent {
  id: number;
  eventType: string;
  at: string;
  payload: Record<string, unknown> | null;
}

export interface CreateJobRequest {
  definitionKey: string;
  definitionVersion?: number;
  params?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
}

export interface CreateJobResponse {
  jobId: string;
  status: JobStatus;
}

export interface JobListResponse {
  jobs: Job[];
  total: number;
}

export interface JobEventsResponse {
  jobId: string;
  events: JobEvent[];
}

// Metrics Types
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

export interface MetricsResponse {
  summary: JobMetricsSummary;
  performance: JobPerformanceStats;
  throughput: JobThroughput;
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

export interface DefinitionMetricsResponse {
  definitions: DefinitionMetrics[];
}

export interface ThroughputDataPoint {
  period: string;
  completed: number;
  failed: number;
}

export interface ThroughputResponse {
  data: ThroughputDataPoint[];
}

// DLQ Types
export interface DlqJob {
  dlqJobId: string;
  originalJobId: string;
  definitionKey: string;
  definitionVersion: number;
  priority: number;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string;
  errorSummary: string;
  movedToDlqAt: string;
}

export interface DlqJobDetail extends DlqJob {
  params: Record<string, unknown>;
  idempotencyKey: string | null;
}

export interface DlqListResponse {
  jobs: DlqJob[];
  total: number;
}

export interface RetryDlqJobRequest {
  maxAttempts?: number;
}

export interface RetryDlqJobResponse {
  jobId: string;
  status: JobStatus;
  message: string;
}

// API Error Response
export interface ApiError {
  error: string;
  details?: unknown;
  message?: string;
}