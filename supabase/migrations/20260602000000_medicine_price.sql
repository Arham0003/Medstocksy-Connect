-- ============================================================================
-- PATCH: Per-medicine price (for the Quick Rx "upload → medicine + price" tiles)
-- ============================================================================
-- When staff upload a bill scan, they enter each medicine + its price as a
-- small tile. This stores that per-line price; the prescription's total_cost
-- is the sum (computed in the app).
-- ============================================================================

BEGIN;

ALTER TABLE public.crm_prescription_medicines
  ADD COLUMN IF NOT EXISTS price numeric(10,2)
    CHECK (price IS NULL OR price >= 0);

NOTIFY pgrst, 'reload schema';

COMMIT;
