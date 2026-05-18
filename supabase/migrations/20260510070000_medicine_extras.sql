-- ============================================================================
-- PATCH: More fields on prescription medicines (form, strength, route,
--        substitution_allowed, medicine_notes)
-- ============================================================================
-- All optional. All pharmacy-operational, not deep medical history (PRD §10).
-- ============================================================================

BEGIN;

ALTER TABLE public.crm_prescription_medicines
  ADD COLUMN IF NOT EXISTS form text,
  ADD COLUMN IF NOT EXISTS strength text,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS substitution_allowed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS medicine_notes text;

NOTIFY pgrst, 'reload schema';

COMMIT;
