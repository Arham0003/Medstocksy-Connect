# Feature Specification: Dashboard Analytics & Interactive Charts

**Feature Branch**: `001-dashboard-charts`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "user want something on dashboard what shows like charts, graphs, which makes the dashboard look premium and useful dashboard. So first of all, go for the search that what the kind of graphs that we can use. I would rather prefer to go for shadcn graphs, but I just wanted to know that what kind of graphs that we can show on the dashboard so that you that can help the user which also makes the design look better as well as which that helps the users. Focus on CRM value (reminder conversions, chronic cohorts) with strict mobile and desktop-first responsive design."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refill Reminder Conversion & Communication ROI (Priority: P1)

As a pharmacy owner or manager, I want to see an interactive grouped bar chart showing automated reminders dispatched versus actual completed prescription refills, so that I can evaluate customer response rates and measure the tangible ROI of WhatsApp and SMS outreach.

**Why this priority**: The primary mission of Medstocksy Connect is driving customer retention and repeat prescription refills. Visualizing reminders sent alongside actual refills completed directly validates CRM performance.

**Independent Test**: Can be tested independently by logging reminders and refill transactions across a 7-day or 30-day window and verifying that the grouped bar chart accurately displays dispatched vs. converted volume and the calculated conversion rate.

**Acceptance Scenarios**:
1. **Given** a pharmacy with scheduled/dispatched reminders and recorded refills, **When** the user views the dashboard, **Then** a grouped bar chart displays daily or weekly counts of "Reminders Sent" (Trust Blue) alongside "Refills Completed" (Care Green), with an aggregate conversion percentage pill (e.g., `72% Conversion Rate`).
2. **Given** the chart on a desktop screen, **When** the user hovers over any day, **Then** an interactive tooltip reveals the exact date, count of reminders sent, count of refills recorded, and the day's conversion percentage.
3. **Given** the chart on a mobile phone (360px–420px viewport), **When** viewed in portrait orientation, **Then** the chart renders with compact single-letter date markers (`M, T, W, T, F, S, S`), touch-friendly interactive scrub states, and summary cards stacked cleanly without horizontal page scrolling.

---

### User Story 2 - Patient Cohort & Chronic Care Distribution (Priority: P2)

As a pharmacist managing recurring patients, I want an interactive donut chart with center metrics showing the breakdown of our customer base (Chronic Care, Repeat, New, High Value, Inactive), so that I can instantly assess the health of our chronic patient retention and access filtered patient lists in one click.

**Why this priority**: Chronic therapy patients represent the vast majority of recurring pharmacy revenue. Tracking chronic vs. new/inactive cohorts ensures proactive disease-management retention.

**Independent Test**: Can be tested by classifying customer profiles with varying purchase frequencies and verifying that the donut chart calculates exact counts, percentages, and highlights the central Chronic Care ratio.

**Acceptance Scenarios**:
1. **Given** active pharmacy customers categorized by auto-tags, **When** viewing the cohort card, **Then** a clean donut chart renders with designated theme colors (Chronic: Purple, Repeat: Green, New: Blue, High Value: Amber, Inactive: Slate) and the center displays total patient count alongside the `% Chronic Care` ratio.
2. **Given** the donut chart on desktop or mobile, **When** tapping or clicking any cohort segment or legend chip, **Then** the user is navigated directly to the Customer Directory filtered by that segment (e.g. `/customers?segment=chronic`).
3. **Given** a mobile viewport, **When** viewing the cohort card, **Then** the legend wraps gracefully into structured tap chips below the donut without clipping text or overflowing the card container.

---

### User Story 3 - Top Refill Therapy & Medication Categories (Priority: P3)

As a pharmacy operator, I want to see a horizontal bar chart of the top medication/disease refill categories (e.g., Diabetes, Hypertension, Cardiac, Respiratory, Thyroid), so that I can anticipate recurring inventory demand.

**Why this priority**: Supports inventory planning and therapeutic adherence tracking without cluttering the primary dashboard view.

**Independent Test**: Can be tested by creating prescriptions with diverse therapeutic categories and verifying ranking by refill count.

**Acceptance Scenarios**:
1. **Given** logged prescriptions with categorised medicines, **When** viewing the therapy breakdown widget, **Then** horizontal bars rank the top 5 therapy categories with total refill counts and percentage shares.

---

### Edge Cases & Responsive Specifications

- **Mobile Viewports (<640px)**:
  - Charts stack vertically in a single-column layout.
  - Donut chart scales to a compact 180px–200px diameter with center typography proportionally sized.
  - Touch targets for interactive data points and legend chips meet minimum 44×44px hit-box requirements.
  - Zero horizontal document overflow (`overflow-x: hidden`).
- **Desktop & Ultra-wide Viewports (>=1024px / 1440px)**:
  - 2-column bento grid pairing the Refill Conversion chart (span-1 or 2) with the Patient Cohort Donut card.
  - Rich hover tooltips with shadow elevation, smooth animations, and high contrast.
- **Zero / Low-Data State**:
  - When a pharmacy has fewer than 3 transactions, charts render a soft empty state with an informative placeholder explaining how data populates as reminders and refills occur.
- **Dynamic Orientation Switching**:
  - Rotating a mobile tablet between portrait and landscape dynamically resizes Recharts containers without breaking SVG bounding boxes (`ResponsiveContainer`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display an interactive Grouped Bar Chart (`bar-chart-multiple`) showing daily/weekly Reminders Sent vs. Refills Completed.
- **FR-002**: System MUST compute and display an aggregate Refill Conversion Percentage based on actual refill transaction records (`crm_prescription_refills` and `crm_scheduled_reminders`).
- **FR-003**: System MUST display an interactive Donut Chart with center summary text (`pie-chart-donut-text`) representing customer cohort distribution.
- **FR-004**: System MUST allow users to tap/click cohort segments to navigate directly to the filtered customer directory.
- **FR-005**: Charts MUST be built using standard Shadcn/UI chart primitives powered by accessible, responsive SVG rendering (`recharts`).
- **FR-006**: All chart color tokens MUST strictly follow the Medstocksy Connect design system (Trust Blue `#2563EB`, Care Green `#10B981`, Chronic Violet `#8B5CF6`, Warning Amber `#F59E0B`, Inactive Slate `#94A3B8`).
- **FR-007**: Charts MUST include lightweight skeleton loaders during query execution to prevent cumulative layout shift (CLS).
- **FR-008**: System MUST support responsive breakpoints (Mobile <640px, Tablet 640px–1023px, Desktop >=1024px) with adaptive typography and spacing.
- **FR-009**: System MUST automatically refresh chart data when reminders are marked sent or refills are recorded (realtime cache invalidation).

### Key Entities

- **Refill Conversion Metric**: An aggregate entity calculating total dispatched reminders, matching refill transactions within the attribution window, and the resulting conversion percentage.
- **Customer Cohort Segment**: A categorical grouping entity containing tag name, customer count, percentage of total patient base, and associated color token.
- **Therapy Category Metric**: A ranked aggregation of prescription refills grouped by therapeutic indication.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of charts render cleanly and without horizontal scrolling or element truncation on mobile screens down to 360px width.
- **SC-002**: On desktop displays (1080p and 1440p), chart layouts adapt into a balanced multi-column grid with clear visual hierarchy.
- **SC-003**: Pharmacy operators can identify their refill conversion rate and chronic patient percentage within 3 seconds of loading the dashboard.
- **SC-004**: Initial chart rendering and interactive state transitions complete in under 500ms.
- **SC-005**: Cumulative Layout Shift (CLS) remains below 0.02 across all screen resolutions during dashboard load.

## Assumptions

- Shadcn chart primitives (`chart.tsx`) and `recharts` will be installed and styled according to the project's Tailwind and CSS variable tokens.
- A completed refill is identified when a record in `crm_prescription_refills` exists for the customer or when a reminder status is updated to `converted`.
- Mobile users interact primarily via touch/tap rather than mouse hover; tooltip trigger behavior adapts accordingly.
