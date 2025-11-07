import {
  Job,
  JobListResponse,
  JobEventsResponse,
  CreateJobRequest,
  CreateJobResponse,
  MetricsResponse,
  DefinitionMetricsResponse,
  ThroughputResponse,
  JobPerformanceStats,
  DlqListResponse,
  DlqJobDetail,
  RetryDlqJobRequest,
  RetryDlqJobResponse,
  ApiError,
  JobStatus,
} from '@/types/api';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error: ApiError = await response.json().catch(() => ({
        error: 'Network error',
        message: `HTTP ${response.status}: ${response.statusText}`,
      }));
      throw new Error(error.message || error.error);
    }

    return response.json();
  }

  // Job Management
  async createJob(request: CreateJobRequest): Promise<CreateJobResponse> {
    return this.request('/v1/jobs', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getJob(jobId: string): Promise<Job> {
    return this.request(`/v1/jobs/${jobId}`);
  }

  async listJobs(
    status?: JobStatus,
    definitionKey?: string,
    limit = 100,
    offset = 0
  ): Promise<JobListResponse> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (definitionKey) params.append('definitionKey', definitionKey);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    
    const query = params.toString();
    return this.request(`/v1/jobs${query ? `?${query}` : ''}`);
  }

  async cancelJob(jobId: string): Promise<{ message: string }> {
    return this.request(`/v1/jobs/${jobId}/cancel`, {
      method: 'POST',
    });
  }

  async getJobEvents(jobId: string): Promise<JobEventsResponse> {
    return this.request(`/v1/jobs/${jobId}/events`);
  }

  // Metrics
  async getMetrics(ttl?: number): Promise<MetricsResponse> {
    const params = new URLSearchParams();
    if (ttl) params.append('ttl', ttl.toString());
    
    const query = params.toString();
    return this.request(`/v1/metrics${query ? `?${query}` : ''}`);
  }

  async getDefinitionMetrics(ttl?: number): Promise<DefinitionMetricsResponse> {
    const params = new URLSearchParams();
    if (ttl) params.append('ttl', ttl.toString());
    
    const query = params.toString();
    return this.request(`/v1/metrics/definitions${query ? `?${query}` : ''}`);
  }

  async getThroughputMetrics(hours = 24, ttl?: number): Promise<ThroughputResponse> {
    const params = new URLSearchParams();
    if (hours) params.append('hours', hours.toString());
    if (ttl) params.append('ttl', ttl.toString());
    
    const query = params.toString();
    return this.request(`/v1/metrics/throughput${query ? `?${query}` : ''}`);
  }

  async getPerformanceMetrics(ttl?: number): Promise<JobPerformanceStats> {
    const params = new URLSearchParams();
    if (ttl) params.append('ttl', ttl.toString());
    
    const query = params.toString();
    return this.request(`/v1/metrics/performance${query ? `?${query}` : ''}`);
  }

  // Dead Letter Queue
  async listDlqJobs(
    definitionKey?: string,
    limit = 100,
    offset = 0
  ): Promise<DlqListResponse> {
    const params = new URLSearchParams();
    if (definitionKey) params.append('definitionKey', definitionKey);
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    
    const query = params.toString();
    return this.request(`/v1/dlq${query ? `?${query}` : ''}`);
  }

  async getDlqJob(dlqJobId: string): Promise<DlqJobDetail> {
    return this.request(`/v1/dlq/${dlqJobId}`);
  }

  async retryDlqJob(
    dlqJobId: string,
    request?: RetryDlqJobRequest
  ): Promise<RetryDlqJobResponse> {
    return this.request(`/v1/dlq/${dlqJobId}/retry`, {
      method: 'POST',
      body: request ? JSON.stringify(request) : undefined,
    });
  }
}

// Export singleton instance
export const api = new ApiClient();
export default api;