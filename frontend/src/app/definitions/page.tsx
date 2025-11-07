'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/metrics/MetricCard';
import { DefinitionMetricsChart } from '@/components/charts/DefinitionMetricsChart';
import { Navigation } from '@/components/layout/Navigation';
import { api } from '@/lib/api';
import { DefinitionMetrics } from '@/types/api';
import { 
  BarChart3, 
  CheckCircle, 
  XCircle,
  Clock,
  Target,
  TrendingUp
} from 'lucide-react';

export default function DefinitionsPage() {
  const [definitions, setDefinitions] = useState<DefinitionMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDefinitions = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.getDefinitionMetrics();
      setDefinitions(response.definitions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch definition metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDefinitions();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchDefinitions, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalJobs = definitions.reduce((sum, def) => sum + def.total, 0);
  const totalSucceeded = definitions.reduce((sum, def) => sum + def.byStatus.succeeded, 0);
  const totalFailed = definitions.reduce((sum, def) => sum + def.byStatus.failed, 0);
  const overallSuccessRate = totalJobs > 0 ? (totalSucceeded / totalJobs) * 100 : 0;
  const avgProcessingTime = definitions.length > 0 
    ? definitions.reduce((sum, def) => sum + (def.avgProcessingTime || 0), 0) / definitions.length 
    : 0;

  const topPerformers = definitions
    .filter(def => def.total >= 10) // Only consider definitions with meaningful sample size
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 3);

  const bottomPerformers = definitions
    .filter(def => def.total >= 10)
    .sort((a, b) => a.successRate - b.successRate)
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <Navigation onRefresh={fetchDefinitions} isRefreshing={loading} />
      
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
                description="Active job definitions"
                icon={BarChart3}
              />
              <MetricCard
                title="Overall Success Rate"
                value={`${Math.round(overallSuccessRate)}%`}
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

            {/* Performance Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Definition Performance Comparison</CardTitle>
                <CardDescription>
                  Success vs failure rates for each job definition
                </CardDescription>
              </CardHeader>
              <CardContent>
                {definitions.length > 0 ? (
                  <DefinitionMetricsChart data={definitions} />
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                    No definition metrics available
                  </div>
                )}
              </CardContent>
            </Card>

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
            <Card>
              <CardHeader>
                <CardTitle>Detailed Metrics by Definition</CardTitle>
                <CardDescription>
                  Comprehensive performance statistics for each job definition
                </CardDescription>
              </CardHeader>
              <CardContent>
                {definitions.length > 0 ? (
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
                        {definitions.map((def) => (
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
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No job definitions found
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}