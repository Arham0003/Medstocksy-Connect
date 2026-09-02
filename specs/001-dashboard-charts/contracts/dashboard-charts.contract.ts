/**
 * Dashboard Charts UI & Data Contracts
 * Feature: 001-dashboard-charts
 */

import type { RefillConversionTimelinePoint, PatientCohortSegment } from '../data-model';

/** Props for the Stacked / Grouped Bar Conversion Chart component */
export interface RefillConversionBarChartProps {
  /** Time series data points */
  data: RefillConversionTimelinePoint[];
  /** Overall conversion rate percentage (e.g. 72) */
  overallConversionRate: number;
  /** Period trend delta percentage (e.g. 5.2) */
  trendDelta?: number;
  /** Loading state */
  isLoading?: boolean;
}

/** Props for the Patient Cohort Pie / Donut Chart component */
export interface PatientCohortPieChartProps {
  /** Cohort segment breakdown */
  data: PatientCohortSegment[];
  /** Total customer count */
  totalCustomers: number;
  /** Chronic percentage to highlight in center */
  chronicPercentage: number;
  /** Period trend delta percentage (e.g. 3.4) */
  trendDelta?: number;
  /** Callback when user clicks a segment */
  onSelectSegment?: (segmentKey: string) => void;
  /** Loading state */
  isLoading?: boolean;
}
