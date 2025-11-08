'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/metrics/MetricCard';
import { DefinitionMetricsChart } from '@/components/charts/DefinitionMetricsChart';
import { Navigation } from '@/components/layout/Navigation';
import { api } from '@/lib/api';
import { DefinitionMetrics, JobDefinition } from '@/types/api';
import { 
  BarChart3, 
  CheckCircle, 
  XCircle,
  Clock,
  Target,
  TrendingUp,
  Settings,
  Zap
} from 'lucide-react';

export default function DefinitionsPage() {
  const [definitions, setDefinitions] = useState<JobDefinition[]>([]);
  const [metrics, setMetrics] = useState<DefinitionMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [definitionsResponse, metricsResponse] = await Promise.all([
        api.getJobDefinitions(),
        api.getDefinitionMetrics().catch(() => ({ definitions: [] })), // Metrics may be empty if no jobs exist
      ]);
      
      setDefinitions(definitionsResponse.definitions);
      setMetrics(metricsResponse.definitions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch definitions');
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

  // Create a map of metrics by definition key+version for quick lookup
  const metricsMap = new Map<string, DefinitionMetrics>();
  metrics.forEach(m => {
    metricsMap.set(`${m.definitionKey}@${m.definitionVersion}`, m);
  });

  const totalJobs = metrics.reduce((sum, def) => sum + def.total, 0);
  const totalSucceeded = metrics.reduce((sum, def) => sum + def.byStatus.succeeded, 0);
  const totalFailed = metrics.reduce((sum, def) => sum + def.byStatus.failed, 0);
  const overallSuccessRate = totalJobs > 0 ? (totalSucceeded / totalJobs) * 100 : 0;
  const avgProcessingTime = metrics.length > 0 
    ? metrics.reduce((sum, def) => sum + (def.avgProcessingTime || 0), 0) / metrics.length 
    : 0;

  const topPerformers = metrics
    .filter(def => def.total >= 10) // Only consider definitions with meaningful sample size
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 3);

  const bottomPerformers = metrics
    .filter(def => def.total >= 10)
    .sort((a, b) => a.successRate - b.successRate)
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <Navigation onRefresh={fetchData} isRefreshing={loading} />
      
      <div className="container mx-auto p-6 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-8 w-8" />
            Job Definitions Analytics
          </h1>
          <p className="text-muted-foreground">
            Performance metrics and analytics for each job definition
          </p>
        </div>

        {error ? (
          <div className="text-center py-8 text-destructive">
            Error: {error}
          </div>
        ) : loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading definition metrics...
          </div>
        ) : (
          <>
            {/* Overview Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                title="Total Definitions"
                value={definitions.length}
                description="Registered job definitions"
                icon={Settings}
              />
              <MetricCard
                title="Overall Success Rate"
                value={totalJobs > 0 ? `${Math.round(overallSuccessRate)}%` : 'N/A'}
                description="Across all definitions"
                icon={CheckCircle}
              />
              <MetricCard
                title="Total Jobs Processed"
                value={totalJobs.toLocaleString()}
                description="All-time across definitions"
                icon={Target}
              />
              <MetricCard
                title="Avg Processing Time"
                value={avgProcessingTime > 0 ? `${Math.round(avgProcessingTime)}s` : 'N/A'}
                description="Average across definitions"
                icon={Clock}
              />
            </div>

            {/* Job Definitions List */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Registered Job Definitions
                </CardTitle>
                <CardDescription>
                  All job definitions available in the system
                </CardDescription>
              </CardHeader>
              <CardContent>
                {definitions.length > 0 ? (
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-4 text-left">Definition Key</th>
                          <th className="p-4 text-right">Version</th>
                          <th className="p-4 text-right">Default Max Attempts</th>
                          <th className="p-4 text-right">Timeout (seconds)</th>
                          <th className="p-4 text-right">Concurrency Limit</th>
                          <th className="p-4 text-right">Jobs Processed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {definitions.map((def) => {
                          const metric = metricsMap.get(`${def.key}@${def.version}`);
                          return (
                            <tr key={`${def.key}-${def.version}`} className="border-b hover:bg-muted/25">
                              <td className="p-4">
                                <p className="font-medium">{def.key}</p>
                              </td>
                              <td className="p-4 text-right">v{def.version}</td>
                              <td className="p-4 text-right">{def.defaultMaxAttempts}</td>
                              <td className="p-4 text-right">{def.timeoutSeconds.toLocaleString()}</td>
                              <td className="p-4 text-right">
                                {def.concurrencyLimit === 0 ? 'Unlimited' : def.concurrencyLimit}
                              </td>
                              <td className="p-4 text-right">
                                {metric ? (
                                  <span className="font-medium">{metric.total.toLocaleString()}</span>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No job definitions found. Run <code className="bg-muted px-2 py-1 rounded">npm run register-definitions</code> to register definitions.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance Chart */}
            {metrics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Definition Performance Comparison</CardTitle>
                  <CardDescription>
                    Success vs failure rates for each job definition
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DefinitionMetricsChart data={metrics} />
                </CardContent>
              </Card>
            )}

            {/* Top and Bottom Performers */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Top Performers */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-700">
                    <TrendingUp className="h-5 w-5" />
                    Top Performers
                  </CardTitle>
                  <CardDescription>
                    Job definitions with highest success rates (min. 10 jobs)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {topPerformers.length > 0 ? (
                    <div className="space-y-4">
                      {topPerformers.map((def, index) => (
                        <div key={`${def.definitionKey}-${def.definitionVersion}`} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 text-sm font-medium">
                              {index + 1}
                            </div>
                            <div>
                              <p className="font-medium">{def.definitionKey}</p>
                              <p className="text-sm text-muted-foreground">v{def.definitionVersion}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-green-700">{Math.round(def.successRate * 100)}%</p>
                            <p className="text-sm text-muted-foreground">{def.total} jobs</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No definitions with sufficient data
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Bottom Performers */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-red-700">
                    <XCircle className="h-5 w-5" />
                    Needs Attention
                  </CardTitle>
                  <CardDescription>
                    Job definitions with lowest success rates (min. 10 jobs)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {bottomPerformers.length > 0 ? (
                    <div className="space-y-4">
                      {bottomPerformers.map((def, index) => (
                        <div key={`${def.definitionKey}-${def.definitionVersion}`} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 text-sm font-medium">
                              {index + 1}
                            </div>
                            <div>
                              <p className="font-medium">{def.definitionKey}</p>
                              <p className="text-sm text-muted-foreground">v{def.definitionVersion}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-red-700">{Math.round(def.successRate * 100)}%</p>
                            <p className="text-sm text-muted-foreground">{def.total} jobs</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No definitions with sufficient data
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Detailed Metrics Table */}
            {metrics.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Detailed Metrics by Definition</CardTitle>
                <CardDescription>
                  Comprehensive performance statistics for each job definition
                </CardDescription>
              </CardHeader>
              <CardContent>
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-4 text-left">Definition</th>
                          <th className="p-4 text-right">Total Jobs</th>
                          <th className="p-4 text-right">Success Rate</th>
                          <th className="p-4 text-right">Succeeded</th>
                          <th className="p-4 text-right">Failed</th>
                          <th className="p-4 text-right">Running</th>
                          <th className="p-4 text-right">Queued</th>
                          <th className="p-4 text-right">Avg Processing</th>
                          <th className="p-4 text-right">Avg Queue Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((def) => (
                          <tr key={`${def.definitionKey}-${def.definitionVersion}`} className="border-b hover:bg-muted/25">
                            <td className="p-4">
                              <div>
                                <p className="font-medium">{def.definitionKey}</p>
                                <p className="text-muted-foreground text-xs">v{def.definitionVersion}</p>
                              </div>
                            </td>
                            <td className="p-4 text-right font-medium">{def.total.toLocaleString()}</td>
                            <td className="p-4 text-right">
                              <span className={`font-medium ${
                                def.successRate >= 0.9 ? 'text-green-600' : 
                                def.successRate >= 0.7 ? 'text-yellow-600' : 
                                'text-red-600'
                              }`}>
                                {Math.round(def.successRate * 100)}%
                              </span>
                            </td>
                            <td className="p-4 text-right text-green-600">{def.byStatus.succeeded.toLocaleString()}</td>
                            <td className="p-4 text-right text-red-600">{def.byStatus.failed.toLocaleString()}</td>
                            <td className="p-4 text-right text-blue-600">{def.byStatus.running.toLocaleString()}</td>
                            <td className="p-4 text-right text-yellow-600">{def.byStatus.queued.toLocaleString()}</td>
                            <td className="p-4 text-right">
                              {def.avgProcessingTime ? `${Math.round(def.avgProcessingTime)}s` : 'N/A'}
                            </td>
                            <td className="p-4 text-right">
                              {def.avgQueueTime ? `${Math.round(def.avgQueueTime)}s` : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              </CardContent>
            </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}