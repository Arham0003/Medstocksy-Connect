-- ============================================================================
-- PATCH: Prescriptions (ported from legacy medcrm-app, scoped per PRD Rule 10)
-- ============================================================================
-- Two tables:
--   • crm_prescriptions          — header (customer, doctor, date, diagnosis, notes)
--   • crm_prescription_medicines — per-medicine line (name, dosage, frequency,
--                                  duration_days, refill_interval_days)
--
-- Optional fields (doctor_name, diagnosis, notes, dosage) stay nullable to
-- keep entry friction low. No image_url, no doctor_phone, no signature — that
-- is e-prescription / EMR territory and out of v1 scope.
--
-- Why no `image_url`: legacy schema had it but the UI never captured it; we
-- drop the carry-over to avoid carrying dead columns into v2.
-- ============================================================================

BEGIN;

-- ── 1. Header ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_prescriptions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id       uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  doctor_name       text,
  prescription_date date NOT NULL DEFAULT current_date,
  diagnosis         text,
  notes             text,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_prescriptions_customer
  ON public.crm_prescriptions(customer_id, prescription_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_prescriptions_pharmacy
  ON public.crm_prescriptions(pharmacy_id, prescription_date DESC);

-- ── 2. Medicine line items ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_prescription_medicines (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  prescription_id       uuid NOT NULL REFERENCES public.crm_prescriptions(id) ON DELETE CASCADE,
  position              smallint NOT NULL DEFAULT 0,
  medicine_name         text NOT NULL,
  dosage                text,
  frequency             text NOT NULL DEFAULT 'Once daily',
  duration_days         smallint CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 365),
  refill_interval_days  smallint CHECK (refill_interval_days IS NULL OR refill_interval_days BETWEEN 1 AND 365)
);

CREATE INDEX IF NOT EXISTS idx_crm_rx_meds_prescription
  ON public.crm_prescription_medicines(prescription_id, position);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_prescriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prescription_medicines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prescriptions_member ON public.crm_prescriptions;
CREATE POLICY prescriptions_member ON public.crm_prescriptions FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS rx_meds_member ON public.crm_prescription_medicines;
CREATE POLICY rx_meds_member ON public.crm_prescription_medicines FOR ALL TO authenticated
  USING (
    prescription_id IN (
      SELECT id FROM public.crm_prescriptions
      WHERE public.crm_is_member(pharmacy_id)
    )
  )
  WITH CHECK (
    prescription_id IN (
      SELECT id FROM public.crm_prescriptions
      WHERE public.crm_is_member(pharmacy_id)
    )
  );

-- ── 4. Audit + updated_at triggers ──────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_crm_prescriptions ON public.crm_prescriptions;
CREATE TRIGGER audit_crm_prescriptions
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_trigger();

DROP TRIGGER IF EXISTS set_updated_at ON public.crm_prescriptions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.crm_prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
