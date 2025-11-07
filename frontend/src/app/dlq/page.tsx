'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Navigation } from '@/components/layout/Navigation';
import { api } from '@/lib/api';
import { DlqJob, DlqJobDetail } from '@/types/api';
import { format, parseISO } from 'date-fns';
import { 
  Search, 
  RotateCcw,
  Eye,
  X,
  AlertTriangle,
  Calendar
} from 'lucide-react';

export default function DlqPage() {
  const [dlqJobs, setDlqJobs] = useState<DlqJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [definitionKeyFilter, setDefinitionKeyFilter] = useState('');
  const [selectedJob, setSelectedJob] = useState<DlqJobDetail | null>(null);
  const [loadingJobDetail, setLoadingJobDetail] = useState(false);
  const [retryingJobs, setRetryingJobs] = useState<Set<string>>(new Set());

  const fetchDlqJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.listDlqJobs(
        definitionKeyFilter || undefined,
        100,
        0
      );
      
      setDlqJobs(response.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch DLQ jobs');
    } finally {
      setLoading(false);
    }
  };

  const fetchDlqJobDetail = async (dlqJobId: string) => {
    try {
      setLoadingJobDetail(true);
      const jobDetail = await api.getDlqJob(dlqJobId);
      setSelectedJob(jobDetail);
    } catch (err) {
      console.error('Failed to fetch DLQ job details:', err);
    } finally {
      setLoadingJobDetail(false);
    }
  };

  const handleRetryJob = async (dlqJobId: string, maxAttempts?: number) => {
    try {
      setRetryingJobs(prev => new Set(prev).add(dlqJobId));
      
      await api.retryDlqJob(dlqJobId, maxAttempts ? { maxAttempts } : undefined);
      
      // Refresh the list after successful retry
      await fetchDlqJobs();
    } catch (err) {
      console.error('Failed to retry DLQ job:', err);
    } finally {
      setRetryingJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(dlqJobId);
        return newSet;
      });
    }
  };

  const handleViewJob = (job: DlqJob) => {
    fetchDlqJobDetail(job.dlqJobId);
  };

  const handleCloseDetails = () => {
    setSelectedJob(null);
  };

  useEffect(() => {
    fetchDlqJobs();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchDlqJobs, 30000);
    return () => clearInterval(interval);
  }, [definitionKeyFilter]);

  const filteredJobs = dlqJobs.filter(job =>
    job.dlqJobId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.originalJobId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.definitionKey.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      <Navigation onRefresh={fetchDlqJobs} isRefreshing={loading} />
      
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              Dead Letter Queue
            </h1>
            <p className="text-muted-foreground">
              Manage and retry failed jobs that have exceeded their maximum attempts
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Failed Jobs</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">
                {dlqJobs.length}
              </div>
              <p className="text-xs text-muted-foreground">
                Jobs in dead letter queue
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
            <CardDescription>Filter failed jobs by search term or definition</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by Job ID, Original Job ID, or Definition"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Definition Key</label>
                <Input
                  placeholder="Filter by definition key"
                  value={definitionKeyFilter}
                  onChange={(e) => setDefinitionKeyFilter(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* DLQ Job List */}
        <Card>
          <CardHeader>
            <CardTitle>Failed Jobs ({filteredJobs.length})</CardTitle>
            <CardDescription>
              Jobs that have failed all retry attempts and been moved to the dead letter queue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-center py-8 text-destructive">
                Error: {error}
              </div>
            ) : loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading failed jobs...
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {dlqJobs.length === 0 ? 'No failed jobs in the dead letter queue' : 'No jobs found matching your criteria'}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>DLQ Job ID</TableHead>
                      <TableHead>Original Job ID</TableHead>
                      <TableHead>Definition</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Failed At</TableHead>
                      <TableHead>Moved to DLQ</TableHead>
                      <TableHead>Error Summary</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.map((job) => (
                      <TableRow key={job.dlqJobId}>
                        <TableCell className="font-mono text-xs">
                          {job.dlqJobId.substring(0, 8)}...
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {job.originalJobId.substring(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{job.definitionKey}</span>
                            <span className="text-xs text-muted-foreground">
                              v{job.definitionVersion}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-destructive font-medium">
                            {job.attempts}/{job.maxAttempts}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(parseISO(job.finishedAt), 'MMM dd, HH:mm')}
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(parseISO(job.movedToDlqAt), 'MMM dd, HH:mm')}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <div className="truncate text-xs text-destructive">
                            {job.errorSummary}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewJob(job)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleRetryJob(job.dlqJobId)}
                              disabled={retryingJobs.has(job.dlqJobId)}
                            >
                              <RotateCcw className={`h-4 w-4 ${retryingJobs.has(job.dlqJobId) ? 'animate-spin' : ''}`} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Job Details Modal */}
        {selectedJob && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden m-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle>Failed Job Details</CardTitle>
                <Button variant="ghost" size="sm" onClick={handleCloseDetails}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-6 max-h-[calc(90vh-8rem)] overflow-y-auto">
                {loadingJobDetail ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading job details...
                  </div>
                ) : (
                  <>
                    {/* Basic Info */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">DLQ Job ID</label>
                        <p className="font-mono text-sm bg-muted p-2 rounded">
                          {selectedJob.dlqJobId}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Original Job ID</label>
                        <p className="font-mono text-sm bg-muted p-2 rounded">
                          {selectedJob.originalJobId}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Definition</label>
                        <p className="text-sm">
                          {selectedJob.definitionKey} (v{selectedJob.definitionVersion})
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Attempts</label>
                        <p className="text-sm text-destructive font-medium">
                          {selectedJob.attempts} of {selectedJob.maxAttempts} (Failed all attempts)
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Priority</label>
                        <p className="text-sm">{selectedJob.priority}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Idempotency Key</label>
                        <p className="font-mono text-sm">
                          {selectedJob.idempotencyKey || 'N/A'}
                        </p>
                      </div>
                    </div>

                    {/* Timestamps */}
                    <div className="space-y-3">
                      <h3 className="text-lg font-medium">Timeline</h3>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">Originally Queued:</span>
                          <span>{format(parseISO(selectedJob.queuedAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                        {selectedJob.startedAt && (
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">Started:</span>
                            <span>{format(parseISO(selectedJob.startedAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-4 w-4 text-destructive" />
                          <span className="font-medium">Failed At:</span>
                          <span>{format(parseISO(selectedJob.finishedAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <Calendar className="h-4 w-4 text-destructive" />
                          <span className="font-medium">Moved to DLQ:</span>
                          <span>{format(parseISO(selectedJob.movedToDlqAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Job Parameters */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Job Parameters</label>
                      <pre className="text-sm bg-muted p-3 rounded overflow-x-auto">
                        {JSON.stringify(selectedJob.params, null, 2)}
                      </pre>
                    </div>

                    {/* Error Details */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-destructive">Error Summary</label>
                      <pre className="text-sm bg-destructive/10 p-3 rounded border border-destructive/20 overflow-x-auto">
                        {selectedJob.errorSummary}
                      </pre>
                    </div>

                    {/* Retry Actions */}
                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        onClick={() => handleRetryJob(selectedJob.dlqJobId)}
                        disabled={retryingJobs.has(selectedJob.dlqJobId)}
                        className="flex items-center gap-2"
                      >
                        <RotateCcw className={`h-4 w-4 ${retryingJobs.has(selectedJob.dlqJobId) ? 'animate-spin' : ''}`} />
                        Retry with Original Settings
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleRetryJob(selectedJob.dlqJobId, selectedJob.maxAttempts + 3)}
                        disabled={retryingJobs.has(selectedJob.dlqJobId)}
                        className="flex items-center gap-2"
                      >
                        <RotateCcw className={`h-4 w-4 ${retryingJobs.has(selectedJob.dlqJobId) ? 'animate-spin' : ''}`} />
                        Retry with +3 Attempts
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}