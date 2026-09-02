# Implementation Tasks: Dashboard Analytics & Interactive Charts

**Feature**: `001-dashboard-charts`
**Spec**: [`specs/001-dashboard-charts/spec.md`](file:///e:/Pivot%20New%20Work/Medstocksy-Connect%2018-05-26/specs/001-dashboard-charts/spec.md)
**Plan**: [`specs/001-dashboard-charts/plan.md`](file:///e:/Pivot%20New%20Work/Medstocksy-Connect%2018-05-26/specs/001-dashboard-charts/plan.md)

---

## Phase 1: Setup & Primitives

- [X] **TSK-001**: Install `recharts` dependency
- [X] **TSK-002**: Add `--chart-1` through `--chart-5` CSS variables in `src/index.css`
- [X] **TSK-003**: Create `src/components/ui/chart.tsx` (Shadcn chart primitives)

---

## Phase 2: Core Data & Components

- [X] **TSK-004**: Create `src/hooks/useDashboardCharts.ts` for aggregated timeline & cohort metrics
- [X] **TSK-005**: Create `src/components/crm/RefillConversionChart.tsx` (Stacked Bar Chart with conversion rate)
- [X] **TSK-006**: Create `src/components/crm/PatientCohortChart.tsx` (Pie/Donut Chart with cohort distribution)

---

## Phase 3: Integration & Dashboard Layout

- [X] **TSK-007**: Integrate charts into `src/pages/Dashboard.tsx` with responsive layout (mobile-first single column, desktop 2-column bento grid)

---

## Phase 4: Verification & Polish

- [X] **TSK-008**: Run TypeScript typecheck and build validation
- [X] **TSK-009**: Validate responsive rendering on mobile and desktop viewports
