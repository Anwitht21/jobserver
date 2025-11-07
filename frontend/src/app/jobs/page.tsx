'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { JobStatusBadge } from '@/components/job/JobStatusBadge';
import { Navigation } from '@/components/layout/Navigation';
import { api } from '@/lib/api';
import { Job, JobStatus, JobEventsResponse } from '@/types/api';
import { format, parseISO } from 'date-fns';
import { 
  Search, 
  Filter,
  Eye,
  X,
  Calendar,
  User,
  RefreshCw
} from 'lucide-react';

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [definitionKeyFilter, setDefinitionKeyFilter] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobEvents, setJobEvents] = useState<JobEventsResponse | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await api.listJobs(
        statusFilter === 'all' ? undefined : statusFilter,
        definitionKeyFilter || undefined,
        100,
        0
      );
      
      setJobs(response.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  };

  const fetchJobEvents = async (jobId: string) => {
    try {
      setLoadingEvents(true);
      const events = await api.getJobEvents(jobId);
      setJobEvents(events);
    } catch (err) {
      console.error('Failed to fetch job events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      await fetchJobs(); // Refresh the list
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

  const handleViewJob = (job: Job) => {
    setSelectedJob(job);
    fetchJobEvents(job.jobId);
  };

  const handleCloseDetails = () => {
    setSelectedJob(null);
    setJobEvents(null);
  };

  useEffect(() => {
    fetchJobs();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchJobs, 30000);
    return () => clearInterval(interval);
  }, [statusFilter, definitionKeyFilter]);

  const filteredJobs = jobs.filter(job =>
    job.jobId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.definitionKey.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const canCancelJob = (job: Job) => {
    return job.status === 'queued' || job.status === 'running';
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation onRefresh={fetchJobs} isRefreshing={loading} />
      
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
            <p className="text-muted-foreground">
              Manage and monitor job execution
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by Job ID or Definition Key"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as JobStatus | 'all')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="queued">Queued</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="succeeded">Succeeded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelling">Cancelling</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
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

        {/* Job List */}
        <Card>
          <CardHeader>
            <CardTitle>Job List ({filteredJobs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-center py-8 text-destructive">
                Error: {error}
              </div>
            ) : loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading jobs...
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No jobs found matching your criteria
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job ID</TableHead>
                      <TableHead>Definition</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Queued At</TableHead>
                      <TableHead>Worker ID</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.map((job) => (
                      <TableRow key={job.jobId}>
                        <TableCell className="font-mono text-xs">
                          {job.jobId.substring(0, 8)}...
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
                          <JobStatusBadge status={job.status} />
                        </TableCell>
                        <TableCell>
                          {job.attempts}/{job.maxAttempts}
                        </TableCell>
                        <TableCell>{job.priority}</TableCell>
                        <TableCell className="text-xs">
                          {job.queuedAt ? format(parseISO(job.queuedAt), 'MMM dd, HH:mm') : 'N/A'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {job.workerId ? job.workerId.substring(0, 8) : 'N/A'}
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
                            {canCancelJob(job) && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleCancelJob(job.jobId)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            )}
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
                <CardTitle>Job Details</CardTitle>
                <Button variant="ghost" size="sm" onClick={handleCloseDetails}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-6 max-h-[calc(90vh-8rem)] overflow-y-auto">
                {/* Basic Info */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Job ID</label>
                    <p className="font-mono text-sm bg-muted p-2 rounded">
                      {selectedJob.jobId}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status</label>
                    <div>
                      <JobStatusBadge status={selectedJob.status} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Definition</label>
                    <p className="text-sm">
                      {selectedJob.definitionKey} (v{selectedJob.definitionVersion})
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Attempts</label>
                    <p className="text-sm">
                      {selectedJob.attempts} of {selectedJob.maxAttempts}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Priority</label>
                    <p className="text-sm">{selectedJob.priority}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Worker ID</label>
                    <p className="font-mono text-sm">
                      {selectedJob.workerId || 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Timestamps */}
                <div className="space-y-3">
                  <h3 className="text-lg font-medium">Timeline</h3>
                  <div className="space-y-2">
                    {selectedJob.queuedAt && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Queued:</span>
                        <span>{format(parseISO(selectedJob.queuedAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    )}
                    {selectedJob.startedAt && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Started:</span>
                        <span>{format(parseISO(selectedJob.startedAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    )}
                    {selectedJob.finishedAt && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Finished:</span>
                        <span>{format(parseISO(selectedJob.finishedAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    )}
                    {selectedJob.heartbeatAt && (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">Last Heartbeat:</span>
                        <span>{format(parseISO(selectedJob.heartbeatAt), 'MMM dd, yyyy HH:mm:ss')}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Error Summary */}
                {selectedJob.errorSummary && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-destructive">Error Summary</label>
                    <pre className="text-sm bg-destructive/10 p-3 rounded border border-destructive/20 overflow-x-auto">
                      {selectedJob.errorSummary}
                    </pre>
                  </div>
                )}

                {/* Events */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium">Events</h3>
                    {loadingEvents && <RefreshCw className="h-4 w-4 animate-spin" />}
                  </div>
                  {jobEvents && jobEvents.events.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {jobEvents.events.map((event) => (
                        <div key={event.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded text-sm">
                          <div className="font-medium min-w-0">
                            {event.eventType}
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {format(parseISO(event.at), 'HH:mm:ss')}
                          </div>
                          {event.payload && (
                            <pre className="text-xs bg-background p-2 rounded flex-1 overflow-x-auto">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : jobEvents && jobEvents.events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No events found for this job</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading events...</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}