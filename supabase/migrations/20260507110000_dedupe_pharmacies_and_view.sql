-- Combined patch — safe to run multiple times.
-- 1. De-duplicate any pharmacies per owner (keeps the MOST RECENT one).
-- 2. Enforce one pharmacy per account (UNIQUE on owner_id).
-- 3. Replace crm_my_pharmacies view to include pharmacy_name inline.
--
-- Run in: https://supabase.com/dashboard/project/ypeopwzkemqlgvvgyhcw/sql/new

BEGIN;

-- ── 0. Audit (read-only): show duplicates we're about to clean up ────────────
DO $$
DECLARE
  v_dups text;
BEGIN
  SELECT string_agg(format('owner=%s rows=%s ids=%s', owner_id, n, ids), E'\n')
    INTO v_dups
    FROM (
      SELECT owner_id, count(*) AS n,
             string_agg(id::text, ',' ORDER BY created_at) AS ids
        FROM public.crm_pharmacies
        GROUP BY owner_id
        HAVING count(*) > 1
    ) t;
  IF v_dups IS NOT NULL THEN
    RAISE NOTICE E'Duplicates found, keeping latest per owner:\n%', v_dups;
  ELSE
    RAISE NOTICE 'No duplicates — pre-existing data is clean.';
  END IF;
END $$;

-- ── 1. Drop duplicate pharmacies, keep the most recent per owner_id ──────────
-- All child tables (customers / campaigns / messages / etc.) cascade ON DELETE,
-- so deleting an empty duplicate pharmacy is safe — there's nothing to lose.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY owner_id ORDER BY created_at DESC, id) AS rn
    FROM public.crm_pharmacies
)
DELETE FROM public.crm_pharmacies
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 2. UNIQUE owner_id (now succeeds because duplicates are gone) ────────────
DO $$ BEGIN
  ALTER TABLE public.crm_pharmacies
    ADD CONSTRAINT crm_pharmacies_owner_unique UNIQUE (owner_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already exists from a prior run
  WHEN duplicate_table  THEN NULL;
END $$;

-- ── 3. View with pharmacy_name inline ────────────────────────────────────────
CREATE OR REPLACE VIEW public.crm_my_pharmacies AS
  SELECT m.pharmacy_id, m.role, p.name AS pharmacy_name
    FROM public.crm_members m
    JOIN public.crm_pharmacies p ON p.id = m.pharmacy_id
    WHERE m.user_id = auth.uid()
  UNION
  SELECT p.id AS pharmacy_id, 'admin'::crm_member_role AS role, p.name AS pharmacy_name
    FROM public.crm_pharmacies p
    WHERE p.owner_id = auth.uid();

GRANT SELECT ON public.crm_my_pharmacies TO authenticated;

-- Force PostgREST to reload its schema cache so the API immediately sees
-- the new pharmacy_name column.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify after running (paste each separately):
-- SELECT conname FROM pg_constraint WHERE conname = 'crm_pharmacies_owner_unique';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='crm_my_pharmacies';
-- SELECT id, name, created_at FROM public.crm_pharmacies;
