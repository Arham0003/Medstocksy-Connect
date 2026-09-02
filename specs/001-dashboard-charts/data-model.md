# Data Model: Dashboard Analytics & Interactive Charts

**Feature**: `001-dashboard-charts`
**Date**: 2026-08-28

---

## 1. Entities & Types

### 1.1 `RefillConversionTimelinePoint`
Represents a single date bucket in the Bar Chart comparison.

```typescript
export interface RefillConversionTimelinePoint {
  /** ISO Date string YYYY-MM-DD */
  date: string;
  /** Formatted day label, e.g. "Mon" or "15 Aug" */
  label: string;
  /** Count of reminders sent out */
  reminders: number;
  /** Count of actual prescription refills completed */
  refills: number;
  /** Computed conversion percentage */
  conversion_rate: number;
}
```

### 1.2 `PatientCohortSegment`
Represents a segment in the Cohort Donut Chart.

```typescript
export type CohortKey = 'chronic' | 'repeat' | 'new' | 'high_value' | 'inactive';

export interface PatientCohortSegment {
  /** Unique segment identifier */
  segment: CohortKey;
  /** Display label */
  label: string;
  /** Customer count in this segment */
  count: number;
  /** Percentage of total patient base */
  percentage: number;
  /** CSS Color variable reference */
  fill: string;
}
```

### 1.3 `DashboardAnalyticsData`
Aggregated payload consumed by the dashboard chart components.

```typescript
export interface DashboardAnalyticsData {
  /** Daily data points for the stacked/grouped bar chart */
  conversionTimeline: RefillConversionTimelinePoint[];
  /** Overall period conversion rate (e.g. 68) */
  overallConversionRate: number;
  /** Total reminders sent in period */
  totalRemindersSent: number;
  /** Total refills recorded in period */
  totalRefillsRecorded: number;
  /** Trend delta vs prior equivalent period (e.g. +5.2%) */
  conversionTrendDelta: number;
  
  /** Segments for the pie/donut chart */
  cohorts: PatientCohortSegment[];
  /** Total customers analyzed */
  totalCustomers: number;
  /** Highlight metric: Chronic patient ratio percentage */
  chronicPercentage: number;
}
```

---

## 2. Validation & Boundary Rules

1. **Division by Zero Protection**: If `reminders` is `0`, `conversion_rate` is safely set to `0`.
2. **Missing Dates Filling**: The conversion timeline fills missing days in the 7-day or 14-day window with `{ reminders: 0, refills: 0, conversion_rate: 0 }` to maintain continuous X-axis spacing.
3. **Color Consistency**: Segments must always use fixed theme tokens (`--chart-1` through `--chart-5`), never randomized colors.
