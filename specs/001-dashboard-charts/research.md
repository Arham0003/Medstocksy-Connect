# Technical Research: Dashboard Analytics & Interactive Charts

**Feature**: `001-dashboard-charts`
**Date**: 2026-08-28

---

## 1. Technology & UI Primitives Selection

### Decision: Shadcn/UI Chart Primitives on `recharts`
- **Chosen**: Install `recharts` and add `src/components/ui/chart.tsx` (the official Shadcn Chart wrapper).
- **Rationale**:
  - Direct compatibility with the Shadcn component ecosystem (`Card`, `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`).
  - Provides responsive SVGs (`ResponsiveContainer`) with accessible tooltips (`ChartTooltipContent`) and legends (`ChartLegendContent`).
  - Native CSS variable integration via `ChartConfig` mapping to `--chart-1`, `--chart-2`, etc.
- **Alternatives Considered**:
  - *Raw Chart.js / Canvas*: Harder to theme with Tailwind HSL variables, less declarative in React 18.
  - *Nivo / Visx*: Larger bundle footprint with unnecessary complexity for simple stacked bar and donut charts.

---

## 2. Theme Token Alignment & Palette Mapping

### Decision: Align Chart Colors with Medstocksy Color System
To maintain visual consistency and avoid arbitrary colors:

| Token | HSL / Hex | Semantic Meaning in CRM |
|---|---|---|
| `--chart-1` | `hsl(226 71% 55%)` / `#3B6EF7` | **Primary Brand / Reminders Sent / New Patients** |
| `--chart-2` | `hsl(152 69% 45%)` / `#10B981` | **Care Green / Refills Completed / Repeat Patients** |
| `--chart-3` | `hsl(254 85% 65%)` / `#8B5CF6` | **Chronic Violet / Chronic Cohort** |
| `--chart-4` | `hsl(38 95% 48%)` / `#F59E0B` | **Amber / High Value Cohort** |
| `--chart-5` | `hsl(220 10% 46%)` / `#6B7799` | **Slate / Inactive & At-Risk Cohort** |

These variables will be mapped in `src/index.css` inside `:root` and `.dark`.

---

## 3. Data Query & Aggregation Strategy

### Decision: TanStack React Query + Lightweight Aggregation Service
- **Refill Conversion Timeline (Last 7–14 Days)**:
  - Query `crm_scheduled_reminders` (`status in ('sent', 'converted')`, `sent_at`) and `crm_prescription_refills` (`refilled_at`) within the date window.
  - Group by calendar date (`YYYY-MM-DD`).
  - Compute `conversion_rate = Math.round((refills / Math.max(reminders, 1)) * 100)`.
- **Patient Cohorts**:
  - Aggregate customer tag counts from `crm_tags` / `crm_customer_auto_tags` (`tag in ('chronic', 'repeat', 'new', 'high_value', 'inactive')`).
  - Calculate `% Chronic Patients` relative to total customer count.

---

## 4. Mobile & Desktop Responsive Strategy

### Decision: Adaptive Breakpoints with Clean Mobile Fallbacks
- **Mobile (<640px)**:
  - Vertical stacking (`grid grid-cols-1 gap-4`).
  - XAxis uses abbreviated date ticks (`tickFormatter={(v) => v.slice(0, 3)}` or single letters on small screens).
  - Donut chart uses `max-h-[220px]` with touch-friendly bottom legend chips (min 44px height).
  - No horizontal scrolling (`overflow-x: hidden`).
- **Desktop (>=1024px)**:
  - 2-column bento grid (`grid grid-cols-1 lg:grid-cols-2 gap-6`).
  - Rich tooltips with formatted currency and transaction counts.
  - Interactive legend chips trigger navigation to filtered customer lists.
