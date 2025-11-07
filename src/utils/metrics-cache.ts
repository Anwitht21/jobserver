import { JobMetricsSummary, JobPerformanceStats, JobThroughput, DefinitionMetrics, ThroughputDataPoint } from '../types';
import { 
  getJobMetricsSummary, 
  getJobPerformanceStats, 
  getJobThroughput, 
  getJobMetricsByDefinition, 
  getJobThroughputTimeSeries 
} from '../db/jobs';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class MetricsCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTtl: number = 30 * 1000; // 30 seconds default TTL

  private getCacheKey(key: string): string {
    return `metrics:${key}`;
  }

  private isExpired(entry: CacheEntry<any>, ttl: number): boolean {
    return Date.now() - entry.timestamp > ttl;
  }

  private get<T>(key: string, ttl?: number): T | null {
    const cacheKey = this.getCacheKey(key);
    const entry = this.cache.get(cacheKey);
    
    if (!entry) {
      return null;
    }
    
    const cacheTtl = ttl ?? this.defaultTtl;
    if (this.isExpired(entry, cacheTtl)) {
      this.cache.delete(cacheKey);
      return null;
    }
    
    return entry.data as T;
  }

  private set<T>(key: string, data: T): void {
    const cacheKey = this.getCacheKey(key);
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });
  }

  private async fetchAndCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key, ttl);
    if (cached !== null) {
      return cached;
    }
    
    const data = await fetcher();
    this.set(key, data);
    return data;
  }

  async getMetricsSummary(ttl?: number): Promise<JobMetricsSummary> {
    return this.fetchAndCache('summary', getJobMetricsSummary, ttl);
  }

  async getPerformanceStats(ttl?: number): Promise<JobPerformanceStats> {
    return this.fetchAndCache('performance', getJobPerformanceStats, ttl);
  }

  async getThroughput(ttl?: number): Promise<JobThroughput> {
    return this.fetchAndCache('throughput', getJobThroughput, ttl);
  }

  async getMetricsByDefinition(ttl?: number): Promise<DefinitionMetrics[]> {
    return this.fetchAndCache('by-definition', getJobMetricsByDefinition, ttl);
  }

  async getThroughputTimeSeries(hours: number = 24, ttl?: number): Promise<ThroughputDataPoint[]> {
    const key = `throughput-timeseries:${hours}`;
    return this.fetchAndCache(key, () => getJobThroughputTimeSeries(hours), ttl);
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      // Clear all metrics cache
      const keysToDelete: string[] = [];
      this.cache.forEach((_, key) => {
        if (key.startsWith('metrics:')) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => this.cache.delete(key));
    } else {
      // Clear specific pattern
      const cacheKey = this.getCacheKey(pattern);
      this.cache.delete(cacheKey);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const metricsCache = new MetricsCache();

