-- ============================================================================
-- PATCH: Unify customer stats across sales + visit notes + prescriptions
-- ============================================================================
-- Symptom: Customer profile stat strip ("Last visit / Lifetime spend / Visits
--          / Frequency") shows zeros even after staff add visit notes or
--          prescriptions, because the previous view only counted rows in
--          crm_customer_sales.
--
-- Fix:     Replace crm_customer_stats so visit_count, last_visit_at, and
--          avg_days_between_visits aggregate across all three event tables.
--          lifetime_value still only sums crm_customer_sales.bill_amount —
--          visit notes and prescriptions don't carry money.
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
  -- count(*) is bigint; keep it bigint to match the previous view's column
  -- type so CREATE OR REPLACE VIEW doesn't reject a type change.
  COALESCE((SELECT count(*) FROM events e WHERE e.customer_id = c.id), 0) AS visit_count,
  COALESCE(
    (SELECT sum(bill_amount) FROM public.crm_customer_sales s WHERE s.customer_id = c.id),
    0
  )::numeric(12,2) AS lifetime_value,
  (SELECT max(at) FROM events e WHERE e.customer_id = c.id) AS last_visit_at,
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
