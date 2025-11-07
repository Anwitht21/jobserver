import { Badge } from '@/components/ui/badge';
import { JobStatus } from '@/types/api';

interface JobStatusBadgeProps {
  status: JobStatus;
  className?: string;
}

const statusConfig = {
  queued: {
    variant: 'secondary' as const,
    label: 'Queued',
    className: '',
  },
  running: {
    variant: 'default' as const,
    label: 'Running',
    className: '',
  },
  succeeded: {
    variant: 'default' as const,
    label: 'Succeeded',
    className: 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-100',
  },
  failed: {
    variant: 'destructive' as const,
    label: 'Failed',
    className: '',
  },
  cancelling: {
    variant: 'outline' as const,
    label: 'Cancelling',
    className: '',
  },
  cancelled: {
    variant: 'outline' as const,
    label: 'Cancelled',
    className: '',
  },
} as const;

export function JobStatusBadge({ status, className }: JobStatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge 
      variant={config.variant}
      className={`${config.className} ${className || ''}`}
    >
      {config.label}
    </Badge>
  );
}