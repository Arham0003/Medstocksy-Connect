-- ============================================================================
-- PATCH: Per-medicine refill log
-- ============================================================================
-- Tracks each time a customer comes back to buy the same medicine from a
-- prescription. Drives the "Refilled X times · Last 5d ago · Next due in 25d"
-- summary on the customer profile and tightens the core loop:
--   Bill → Customer → WhatsApp → Reminder → REFILL → next Reminder → …
--
-- Kept minimal per PRD Rule 10:
--   • quantity_dispensed — useful pharmacy operation
--   • bill_amount        — feeds lifetime_value
--   • notes              — short free-form
-- No second prescription required, no doctor re-entry, no schedule decisions
-- (the existing refill_interval_days on the medicine line drives reminders).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_prescription_refills (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id         uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  prescription_id     uuid NOT NULL REFERENCES public.crm_prescriptions(id) ON DELETE CASCADE,
  medicine_id         uuid NOT NULL REFERENCES public.crm_prescription_medicines(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  refilled_at         timestamptz NOT NULL DEFAULT now(),
  quantity_dispensed  smallint CHECK (quantity_dispensed IS NULL OR quantity_dispensed BETWEEN 1 AND 999),
  bill_amount         numeric(12,2) CHECK (bill_amount IS NULL OR bill_amount >= 0),
  notes               text,
  served_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_refills_medicine
  ON public.crm_prescription_refills(medicine_id, refilled_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_refills_customer
  ON public.crm_prescription_refills(customer_id, refilled_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_refills_pharmacy
  ON public.crm_prescription_refills(pharmacy_id, refilled_at DESC);

ALTER TABLE public.crm_prescription_refills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refills_member ON public.crm_prescription_refills;
CREATE POLICY refills_member ON public.crm_prescription_refills FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP TRIGGER IF EXISTS audit_crm_refills ON public.crm_prescription_refills;
CREATE TRIGGER audit_crm_refills
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_prescription_refills
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_trigger();

-- Feed refills into the unified customer stats so visit_count, last_visit_at,
-- and lifetime_value all reflect repeat purchases automatically.
CREATE OR REPLACE VIEW public.crm_customer_stats AS
WITH events AS (
  SELECT customer_id, sold_at AS at FROM public.crm_customer_sales
  UNION ALL
  SELECT customer_id, created_at AS at FROM public.crm_visit_notes
  UNION ALL
  SELECT customer_id, prescription_date::timestamptz AS at FROM public.crm_prescriptions
  UNION ALL
  SELECT customer_id, refilled_at AS at FROM public.crm_prescription_refills
)
SELECT
  c.id          AS customer_id,
  c.pharmacy_id,
  COALESCE((SELECT count(*) FROM events e WHERE e.customer_id = c.id), 0) AS visit_count,
  -- Cast the FINAL sum back to numeric(12,2). Two numeric(12,2) values
  -- added together return unconstrained `numeric`, which would change the
  -- view's column type and break CREATE OR REPLACE VIEW on re-runs.
  (
    COALESCE(
      (SELECT sum(bill_amount) FROM public.crm_customer_sales s WHERE s.customer_id = c.id),
      0
    )
    + COALESCE(
      (SELECT sum(bill_amount) FROM public.crm_prescription_refills r WHERE r.customer_id = c.id),
      0
    )
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
