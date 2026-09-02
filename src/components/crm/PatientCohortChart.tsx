import { useNavigate } from 'react-router-dom';
import { Users, Activity } from 'lucide-react';
import { Label, Pie, PieChart } from 'recharts';

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
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import type { CohortItem } from '@/hooks/useDashboardCharts';

export const cohortChartConfig = {
  count: {
    label: 'Customers',
  },
  chronic: {
    label: 'Chronic Care',
    color: 'hsl(var(--chart-3))',
  },
  repeat: {
    label: 'Repeat Patients',
    color: 'hsl(var(--chart-2))',
  },
  new: {
    label: 'New Patients',
    color: 'hsl(var(--chart-1))',
  },
  high_value: {
    label: 'High Value',
    color: 'hsl(var(--chart-4))',
  },
  inactive: {
    label: 'Inactive',
    color: 'hsl(var(--chart-5))',
  },
} satisfies ChartConfig;

interface PatientCohortChartProps {
  cohorts?: CohortItem[];
  chronicPercentage: number;
  totalCustomers: number;
  isLoading?: boolean;
}

export function PatientCohortChart({
  cohorts = [],
  chronicPercentage,
  totalCustomers,
  isLoading = false,
}: PatientCohortChartProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="flex flex-col justify-between">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="flex items-center justify-center py-6">
          <Skeleton className="h-[180px] w-[180px] rounded-full" />
        </CardContent>
        <CardFooter className="border-t pt-4">
          <Skeleton className="h-4 w-36" />
        </CardFooter>
      </Card>
    );
  }

  // Filter out 0-count cohorts for clean pie visualization
  const activeCohorts = cohorts.filter((c) => c.count > 0);
  const hasData = totalCustomers > 0 && activeCohorts.length > 0;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Patient Cohort Distribution</CardTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
            <Activity className="h-3 w-3" />
            {chronicPercentage}% Chronic
          </span>
        </div>
        <CardDescription className="text-xs">
          Active patient base segmented by clinical retention & visit history
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-2">
        {!hasData ? (
          <div className="flex h-[200px] flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <Users className="mb-2 h-7 w-7 text-muted-foreground/40" />
            <p className="font-medium">No customer data categorized yet</p>
            <p className="mt-0.5 text-[11px]">Tag customers or add prescriptions to build cohort analytics</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
            <ChartContainer
              config={cohortChartConfig}
              className="mx-auto aspect-square max-h-[190px] w-full"
            >
              <PieChart>
                <ChartTooltip
                  content={<ChartTooltipContent nameKey="count" hideLabel />}
                />
                <Pie
                  data={activeCohorts}
                  dataKey="count"
                  nameKey="segment"
                  innerRadius={50}
                  outerRadius={75}
                  strokeWidth={3}
                >
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) - 2}
                              className="fill-foreground font-mono text-xl font-bold tabular-nums"
                            >
                              {chronicPercentage}%
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={(viewBox.cy || 0) + 16}
                              className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wider"
                            >
                              Chronic
                            </tspan>
                          </text>
                        );
                      }
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>

            {/* Quick interactive segment chips for one-tap navigation */}
            <div className="flex flex-col gap-1.5 text-xs">
              {cohorts.map((cohort) => {
                const pct = totalCustomers > 0 ? Math.round((cohort.count / totalCustomers) * 100) : 0;
                return (
                  <button
                    key={cohort.segment}
                    type="button"
                    onClick={() => navigate(`/customers?segment=${cohort.segment}`)}
                    className="group flex items-center justify-between rounded-md px-2.5 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: cohort.fill }}
                      />
                      <span className="text-muted-foreground group-hover:text-foreground font-medium truncate">
                        {cohort.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 tabular-nums font-mono text-[11px]">
                      <span className="font-semibold text-foreground">{cohort.count}</span>
                      <span className="text-muted-foreground text-[10px]">({pct}%)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-1.5 border-t px-6 py-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <span>{totalCustomers} total registered patients</span>
        </div>
        <div className="text-muted-foreground">
          Click any segment to view filtered patient records
        </div>
      </CardFooter>
    </Card>
  );
}
