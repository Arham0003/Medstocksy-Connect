# Implementation Plan: Dashboard Analytics & Interactive Charts

**Branch**: `001-dashboard-charts` | **Date**: 2026-08-28 | **Spec**: [`specs/001-dashboard-charts/spec.md`](file:///e:/Pivot%20New%20Work/Medstocksy-Connect%2018-05-26/specs/001-dashboard-charts/spec.md)

**Input**: Feature specification from `/specs/001-dashboard-charts/spec.md` with Shadcn stacked bar chart and pie/donut chart patterns.

## Summary

Implement two responsive, high-impact Shadcn/UI analytics charts on the Medstocksy Connect pharmacy dashboard:
1. **Refill Reminder Conversion Bar Chart (`ChartBarStacked`)**: Tracks reminders sent versus actual customer refills completed with overall conversion rate.
2. **Patient Cohort & Chronic Distribution Pie/Donut Chart (`ChartPieLabelList`)**: Visualizes patient segments (Chronic, Repeat, New, High Value, Inactive) with center metrics and one-click filtering.

Both charts adhere strictly to mobile-first and desktop-responsive design tokens using `recharts` and Shadcn chart primitives.

## Technical Context

**Language/Version**: TypeScript 5.7, React 18.3, Vite 6.0
**Primary Dependencies**: `recharts`, `lucide-react`, `@tanstack/react-query`, `tailwindcss`, `clsx`, `tailwind-merge`
**Storage**: Supabase PostgreSQL (`crm_scheduled_reminders`, `crm_prescription_refills`, `crm_customers`, `crm_tags`, `crm_customer_auto_tags`)
**Testing**: Manual responsive verification & build typecheck (`npm run typecheck && npm run build`)
**Target Platform**: Web (Mobile touchscreens down to 360px up to 4K Ultra-wide monitors)
**Project Type**: React Single Page Application (CRM)
**Performance Goals**: <500ms chart render, 0 CLS, smooth CSS/SVG transitions
**Constraints**: Zero horizontal viewport overflow on mobile; strictly use design system tokens (`--chart-1` through `--chart-5`)
**Scale/Scope**: 1 dashboard screen, 1 shared chart primitive, 2 CRM chart widgets, 1 query hook

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Simplicity & YAGNI**: Direct integration of requested Shadcn chart patterns without speculative abstractions.
- [x] **Design Theme Rules**: Follows `medstocksy_connect_theme.md` (no visual noise, semantic colors for CRM tags, JetBrains Mono numbers, clean card surfaces).
- [x] **Mobile & Desktop First**: Single-column vertical layout on mobile (<640px) and 2-column bento grid on desktop (>=1024px).
- [x] **Type Safety**: Fully typed data models and interface contracts.

## Project Structure

### Documentation (this feature)

```text
specs/001-dashboard-charts/
├── plan.md              # This implementation plan
├── research.md          # Technology choices, theme tokens, and data aggregation strategy
├── data-model.md        # Entities, timeline points, and cohort data models
├── quickstart.md        # Step-by-step validation guide
├── contracts/
│   └── dashboard-charts.contract.ts # UI and query interface contracts
└── checklists/
    └── requirements.md  # Quality checklist
```

### Source Code Impact

```text
src/
├── components/
│   ├── ui/
│   │   └── chart.tsx                # [NEW] Shadcn Chart primitives (Container, Tooltip, Legend)
│   └── crm/
│       ├── RefillConversionChart.tsx# [NEW] Stacked Bar Chart for Reminders vs Refills
│       └── PatientCohortChart.tsx   # [NEW] Pie / Donut Chart for Patient Segments
├── hooks/
│   └── useDashboardCharts.ts        # [NEW] React Query hook aggregating timeline & cohort metrics
├── pages/
│   └── Dashboard.tsx                # [MODIFY] Embed charts in responsive 2-column bento layout
├── index.css                        # [MODIFY] Add --chart-1 through --chart-5 HSL variables
└── package.json                     # [MODIFY] Add recharts dependency
```

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `recharts` package | Required engine for Shadcn/UI Chart components | Custom SVG/Canvas chart code is harder to maintain and lacks accessible tooltips/legends |
| `useDashboardCharts` hook | Isolates chart timeline and cohort aggregation logic | Inlining in Dashboard.tsx increases file size beyond single responsibility |
