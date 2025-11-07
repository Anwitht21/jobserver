'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ThroughputDataPoint } from '@/types/api';

interface ThroughputChartProps {
  data: ThroughputDataPoint[];
  className?: string;
}

export function ThroughputChart({ data, className }: ThroughputChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    time: format(parseISO(point.period), 'HH:mm'),
    fullTime: format(parseISO(point.period), 'MMM dd, HH:mm'),
  }));

  if (chartData.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[300px] text-muted-foreground ${className}`}>
        No throughput data available
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis 
            dataKey="time" 
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            labelFormatter={(label, payload) => 
              payload?.[0]?.payload?.fullTime || label
            }
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="completed"
            stroke="hsl(var(--chart-3))"
            strokeWidth={2}
            dot={{ fill: 'hsl(var(--chart-3))', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
            name="Completed"
          />
          <Line
            type="monotone"
            dataKey="failed"
            stroke="hsl(var(--destructive))"
            strokeWidth={2}
            dot={{ fill: 'hsl(var(--destructive))', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
            name="Failed"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}