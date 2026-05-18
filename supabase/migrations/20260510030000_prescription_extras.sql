-- ============================================================================
-- PATCH: Prescription extras (quantity, instructions, follow-up date)
-- ============================================================================
-- Three pharmacy-operational fields. Per PRD Rule 10 we resist deeper medical
-- fields (no doctor reg number, no patient weight, no signature image).
-- ============================================================================

BEGIN;

ALTER TABLE public.crm_prescriptions
  ADD COLUMN IF NOT EXISTS follow_up_date date;

ALTER TABLE public.crm_prescription_medicines
  ADD COLUMN IF NOT EXISTS quantity smallint
    CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 999);

ALTER TABLE public.crm_prescription_medicines
  ADD COLUMN IF NOT EXISTS instructions text;

NOTIFY pgrst, 'reload schema';

COMMIT;
