-- ============================================================================
-- PATCH: Family member support — multiple customers can share one phone
-- ============================================================================
-- Symptom:  Saving a new customer fails with
--           "duplicate key value violates unique constraint
--            crm_customers_pharmacy_id_phone_key" when a family member walks
--           in using the same household phone.
--
-- Fix:      Drop the strict UNIQUE(pharmacy_id, phone) and replace it with a
--           PARTIAL unique index that fires only on PRIMARY records
--           (family_of_id IS NULL). So:
--             • Only ONE primary per phone per pharmacy (still dedupes).
--             • Family members can share their primary's phone freely.
--
-- Schema:   new column family_of_id uuid REFERENCES crm_customers(id) ON DELETE CASCADE
-- ============================================================================

BEGIN;

-- 1. Add the self-FK for family membership.
ALTER TABLE public.crm_customers
  ADD COLUMN IF NOT EXISTS family_of_id uuid
    REFERENCES public.crm_customers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_crm_customers_family
  ON public.crm_customers(family_of_id)
  WHERE family_of_id IS NOT NULL;

-- 2. Drop the strict (pharmacy_id, phone) UNIQUE so family members can share
--    a phone. The auto-generated constraint name in postgres is usually
--    `crm_customers_pharmacy_id_phone_key`, but if the user had a different
--    name we fall through; the loop below dynamically drops any UNIQUE on
--    exactly that (pharmacy_id, phone) column pair.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'crm_customers'
        AND con.contype = 'u'
        AND (
          SELECT array_agg(att.attname::text ORDER BY att.attname::text)
            FROM unnest(con.conkey) AS k(attnum)
            JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = k.attnum
        ) = ARRAY['pharmacy_id', 'phone']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public.crm_customers DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped strict UNIQUE constraint %', r.conname;
  END LOOP;
END $$;

-- 3. Partial unique index — only PRIMARIES are deduped by phone.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_crm_customers_primary_phone
  ON public.crm_customers(pharmacy_id, phone)
  WHERE family_of_id IS NULL;

-- 4. Refresh PostgREST schema cache so the API immediately exposes
--    family_of_id.
NOTIFY pgrst, 'reload schema';

COMMIT;
