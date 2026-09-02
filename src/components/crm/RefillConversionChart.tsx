import { TrendingUp, BellRing, CheckCircle2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { RefillTimelineItem } from '@/hooks/useDashboardCharts';

export const chartConfig = {
  reminders: {
    label: 'Reminders Sent',
    color: 'hsl(var(--chart-1))',
    icon: BellRing,
  },
  refills: {
    label: 'Refills Completed',
    color: 'hsl(var(--chart-2))',
    icon: CheckCircle2,
  },
} satisfies ChartConfig;

interface RefillConversionChartProps {
  data?: RefillTimelineItem[];
  overallConversionRate: number;
  totalReminders: number;
  totalRefills: number;
  isLoading?: boolean;
}

export function RefillConversionChart({
  data = [],
  overallConversionRate,
  totalReminders,
  totalRefills,
  isLoading = false,
}: RefillConversionChartProps) {
  if (isLoading) {
    return (
      <Card className="flex flex-col justify-between">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="py-6">
          <Skeleton className="h-[180px] w-full rounded-lg" />
        </CardContent>
        <CardFooter className="border-t pt-4">
          <Skeleton className="h-4 w-40" />
        </CardFooter>
      </Card>
    );
  }

  const hasData = totalReminders > 0 || totalRefills > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Refill & Reminder Conversion</CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {overallConversionRate}% Refill Rate
          </span>
        </div>
        <CardDescription className="text-xs">
          Last 6 days reminder activity vs. completed store refills
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-2">
        {!hasData ? (
          <div className="flex h-[200px] flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <BellRing className="mb-2 h-7 w-7 text-muted-foreground/40" />
            <p className="font-medium">No reminder or refill activity logged yet</p>
            <p className="mt-0.5 text-[11px]">Send reminders or log Quick Rx refills to track conversion</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="max-h-[220px] w-full">
            <BarChart accessibilityLayer data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis
                dataKey="date"
                tickLine={false}
                tickMargin={8}
                axisLine={false}
                tickFormatter={(value) => {
                  const d = new Date(value);
                  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
                }}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(val) => {
                      const d = new Date(val as string);
                      return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
                    }}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent className="pt-2 text-xs" />} />
              <Bar
                dataKey="reminders"
                stackId="a"
                fill="var(--color-reminders)"
                radius={[0, 0, 4, 4]}
              />
              <Bar
                dataKey="refills"
                stackId="a"
                fill="var(--color-refills)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-1.5 border-t px-6 py-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <span>{totalRefills} refills recorded from {totalReminders} sent reminders</span>
          {overallConversionRate >= 50 && <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
        </div>
        <div className="text-muted-foreground">
          Attribution window: refills within 7 days of reminder dispatch
        </div>
      </CardFooter>
    </Card>
  );
}
