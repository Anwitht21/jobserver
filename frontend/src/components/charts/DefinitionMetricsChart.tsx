'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { DefinitionMetrics } from '@/types/api';

interface DefinitionMetricsChartProps {
  data: DefinitionMetrics[];
  className?: string;
}

export function DefinitionMetricsChart({ data, className }: DefinitionMetricsChartProps) {
  const chartData = data.map((def) => ({
    name: def.definitionKey,
    version: `v${def.definitionVersion}`,
    total: def.total,
    succeeded: def.byStatus.succeeded,
    failed: def.byStatus.failed,
    successRate: Math.round(def.successRate * 100),
    avgProcessingTime: def.avgProcessingTime || 0,
  }));

  if (chartData.length === 0) {
    return (
      <div className={`flex items-center justify-center h-[300px] text-muted-foreground ${className}`}>
        No definition metrics available
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis 
            dataKey="name" 
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
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--radius)',
            }}
            formatter={(value, name) => {
              if (name === 'successRate') return [`${value}%`, 'Success Rate'];
              if (name === 'avgProcessingTime') return [`${value}s`, 'Avg Processing Time'];
              return [value, name];
            }}
          />
          <Legend />
          <Bar 
            dataKey="succeeded" 
            fill="hsl(var(--chart-3))" 
            name="Succeeded"
            radius={[0, 0, 0, 0]}
          />
          <Bar 
            dataKey="failed" 
            fill="hsl(var(--destructive))" 
            name="Failed"
            radius={[0, 0, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}