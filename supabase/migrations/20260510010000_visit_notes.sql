-- ============================================================================
-- PATCH: Customer visit notes (PRD §2.7 — Customer Note timeline event)
-- ============================================================================
-- Per PRD Rule 10 (data simplicity), this is intentionally minimal:
--   • note         — short free text (max 1024 chars enforced in app layer)
--   • medicines    — optional array of medicine name strings (no dosage/freq)
--   • added_by     — auth.uid() at insert time
--   • created_at   — timestamp
--
-- This is NOT a medical history table. Dosages, doctor info, structured
-- prescription fields, or image uploads belong to a V2 feature with its own
-- compliance review.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.crm_visit_notes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  note        text NOT NULL,
  medicines   text[] NOT NULL DEFAULT '{}',
  added_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_visit_notes_customer
  ON public.crm_visit_notes(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_visit_notes_pharmacy
  ON public.crm_visit_notes(pharmacy_id, created_at DESC);

ALTER TABLE public.crm_visit_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visit_notes_member ON public.crm_visit_notes;
CREATE POLICY visit_notes_member ON public.crm_visit_notes FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP TRIGGER IF EXISTS audit_crm_visit_notes ON public.crm_visit_notes;
CREATE TRIGGER audit_crm_visit_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_visit_notes
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_trigger();

NOTIFY pgrst, 'reload schema';

COMMIT;
