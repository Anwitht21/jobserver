'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/metrics/MetricCard';
import { StatusPieChart } from '@/components/charts/StatusPieChart';
import { ThroughputChart } from '@/components/charts/ThroughputChart';
import { Navigation } from '@/components/layout/Navigation';
import { api } from '@/lib/api';
import { MetricsResponse, ThroughputResponse } from '@/types/api';
import { 
  Activity, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  TrendingUp,
  Users
} from 'lucide-react';

export default function Dashboard() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [throughputData, setThroughputData] = useState<ThroughputResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [metricsRes, throughputRes] = await Promise.all([
        api.getMetrics(),
        api.getThroughputMetrics(24),
      ]);
      
      setMetrics(metricsRes);
      setThroughputData(throughputRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    fetchData();
  };

  if (loading && !metrics) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation onRefresh={handleRefresh} isRefreshing={loading} />
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation onRefresh={handleRefresh} isRefreshing={loading} />
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-destructive">Error: {error}</div>
          </div>
        </div>
      </div>
    );
  }

  const successRate = metrics?.performance.successRate ? 
    Math.round(metrics.performance.successRate * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navigation onRefresh={handleRefresh} isRefreshing={loading} />
      
      <div className="container mx-auto p-6 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your job server performance and metrics
          </p>
        </div>

        {/* Overview Metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Jobs"
            value={metrics?.summary.total.toLocaleString() || '0'}
            description="All-time job count"
            icon={Activity}
          />
          <MetricCard
            title="Success Rate"
            value={`${successRate}%`}
            description="Job completion success rate"
            icon={CheckCircle}
            trend={successRate > 80 ? { value: 5, label: 'vs last period' } : undefined}
          />
          <MetricCard
            title="Avg Processing Time"
            value={
              metrics?.performance.avgProcessingTime 
                ? `${Math.round(metrics.performance.avgProcessingTime)}s`
                : 'N/A'
            }
            description="Average job processing time"
            icon={Clock}
          />
          <MetricCard
            title="Last Hour Throughput"
            value={metrics?.throughput.lastHour.toLocaleString() || '0'}
            description="Jobs completed in last hour"
            icon={TrendingUp}
          />
        </div>

        {/* Charts Section */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Job Status Distribution</CardTitle>
              <CardDescription>
                Current distribution of jobs by status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metrics ? (
                <StatusPieChart data={metrics.summary.byStatus} />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Throughput Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Throughput Timeline</CardTitle>
              <CardDescription>
                Job completion and failure rates over the last 24 hours
              </CardDescription>
            </CardHeader>
            <CardContent>
              {throughputData ? (
                <ThroughputChart data={throughputData.data} />
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No throughput data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Additional Metrics */}
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            title="Running Jobs"
            value={metrics?.summary.byStatus.running.toLocaleString() || '0'}
            description="Currently executing"
            icon={Users}
          />
          <MetricCard
            title="Queued Jobs"
            value={metrics?.summary.byStatus.queued.toLocaleString() || '0'}
            description="Waiting for execution"
            icon={Clock}
          />
          <MetricCard
            title="Failed Jobs"
            value={metrics?.summary.byStatus.failed.toLocaleString() || '0'}
            description="Requires attention"
            icon={AlertCircle}
          />
        </div>

        {/* Performance Details */}
        {metrics && (
          <Card>
            <CardHeader>
              <CardTitle>Performance Details</CardTitle>
              <CardDescription>
                Detailed performance statistics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Average Queue Time</p>
                  <p className="text-2xl font-bold">
                    {metrics.performance.avgQueueTime 
                      ? `${Math.round(metrics.performance.avgQueueTime)}s` 
                      : 'N/A'}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Retry Rate</p>
                  <p className="text-2xl font-bold">
                    {Math.round(metrics.performance.retryRate * 100)}%
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Last Day Throughput</p>
                  <p className="text-2xl font-bold">
                    {metrics.throughput.lastDay.toLocaleString()}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Last Week Throughput</p>
                  <p className="text-2xl font-bold">
                    {metrics.throughput.lastWeek.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}