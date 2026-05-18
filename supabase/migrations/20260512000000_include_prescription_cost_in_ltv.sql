-- ============================================================================
-- PATCH: Include prescription total_cost in Lifetime Value (LTV)
-- ============================================================================
-- Requirement: Prescription costs should be treated as bill amounts when
--              calculating a customer's lifetime spend.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.crm_customer_stats AS
WITH events AS (
  SELECT customer_id, sold_at AS at
    FROM public.crm_customer_sales
  UNION ALL
  SELECT customer_id, created_at AS at
    FROM public.crm_visit_notes
  UNION ALL
  SELECT customer_id, prescription_date::timestamptz AS at
    FROM public.crm_prescriptions
)
SELECT
  c.id          AS customer_id,
  c.pharmacy_id,
  -- Total visit count across all activity types
  COALESCE((SELECT count(*) FROM events e WHERE e.customer_id = c.id), 0) AS visit_count,
  -- Lifetime Value = Quick Sales + Prescription Refills + Initial Prescription Costs
  (
    COALESCE((SELECT sum(bill_amount) FROM public.crm_customer_sales s WHERE s.customer_id = c.id), 0) +
    COALESCE((SELECT sum(bill_amount) FROM public.crm_prescription_refills r WHERE r.customer_id = c.id), 0) +
    COALESCE((SELECT sum(total_cost) FROM public.crm_prescriptions p WHERE p.customer_id = c.id), 0)
  )::numeric(12,2) AS lifetime_value,
  -- Most recent activity date
  (SELECT max(at) FROM events e WHERE e.customer_id = c.id) AS last_visit_at,
  -- Average days between any activity
  CASE
    WHEN (SELECT count(*) FROM events e WHERE e.customer_id = c.id) >= 2 THEN
      (
        EXTRACT(EPOCH FROM (
          (SELECT max(at) FROM events e WHERE e.customer_id = c.id)
          -
          (SELECT min(at) FROM events e WHERE e.customer_id = c.id)
        ))
        / NULLIF((SELECT count(*) - 1 FROM events e WHERE e.customer_id = c.id), 0)
        / 86400
      )::int
  END AS avg_days_between_visits
FROM public.crm_customers c;

GRANT SELECT ON public.crm_customer_stats TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
