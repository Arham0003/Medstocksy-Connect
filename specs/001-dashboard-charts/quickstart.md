# Quickstart & Validation Guide: Dashboard Analytics & Interactive Charts

**Feature**: `001-dashboard-charts`
**Date**: 2026-08-28

---

## 1. Prerequisites & Dependencies

1. **Install Package**:
   ```bash
   npm install recharts
   ```
2. **Components**:
   - `src/components/ui/chart.tsx` (Shadcn Chart Primitives)
   - `src/components/crm/RefillConversionChart.tsx` (Bar Chart - Stacked + Legend)
   - `src/components/crm/PatientCohortChart.tsx` (Pie / Donut Chart with Label List)
3. **Styles**:
   - Ensure `--chart-1` through `--chart-5` exist in `src/index.css`.

---

## 2. Validation Scenarios

### Scenario 1: Desktop Layout & Hover Interaction
1. Open the dashboard at `http://localhost:5180/` on a desktop screen (>=1024px).
2. Verify both charts render side-by-side in a 2-column bento grid above recent prescriptions.
3. Hover over each bar in the Refill Conversion chart; verify the tooltip displays date, reminders sent, and refills completed.
4. Hover over the Pie/Donut segments; verify tooltips display customer counts and percentages.

### Scenario 2: Mobile Viewport Responsiveness
1. Open Chrome DevTools and switch device emulation to iPhone 14 (390×844px) and Pixel 7 (412×915px).
2. Verify the charts stack vertically (`grid-cols-1`).
3. Check that there is no horizontal page overflow (`overflow-x: hidden`).
4. Verify the XAxis labels and legend wrap cleanly without text clipping.

### Scenario 3: Realtime Refill & Reminder Updates
1. Record a new quick refill or send a reminder to a customer.
2. Return to the dashboard.
3. Verify that the chart data updates in realtime via React Query cache invalidation.

### Scenario 4: Zero Data / Empty State
1. For a brand new pharmacy with zero reminders or refills, verify that empty states render gracefully without console errors or broken SVG elements.
