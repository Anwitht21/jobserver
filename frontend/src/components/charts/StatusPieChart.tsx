'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { JobStatusCounts } from '@/types/api';

interface StatusPieChartProps {
  data: JobStatusCounts;
  className?: string;
}

const STATUS_COLORS = {
  queued: 'hsl(var(--chart-1))',
  running: 'hsl(var(--chart-2))',
  succeeded: 'hsl(var(--chart-3))',
  failed: 'hsl(var(--destructive))',
  cancelling: 'hsl(var(--chart-4))',
  cancelled: 'hsl(var(--chart-5))',
} as const;

export function StatusPieChart({ data, className }: StatusPieChartProps) {
  const chartData = Object.entries(data)
    .filter(([_, value]) => value > 0)
    .map(([status, count]) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: count,
      color: STATUS_COLORS[status as keyof typeof STATUS_COLORS],
    }));

  if (chartData.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[300px] text-muted-foreground ${className}`}>
        No data available
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
            }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}