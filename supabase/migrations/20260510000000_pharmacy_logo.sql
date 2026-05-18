-- ============================================================================
-- PATCH: Pharmacy custom logo
-- ============================================================================
-- Adds:
--   • crm_pharmacies.logo_url (nullable) — public URL of the uploaded logo
--   • crm_my_pharmacies view re-created to surface logo_url alongside role/name
--   • Supabase Storage bucket 'crm-pharmacy-logos' (public read, 2 MB cap)
--
-- Run in: https://supabase.com/dashboard/project/<your-ref>/sql/new
-- ============================================================================

BEGIN;

-- ── 1. Column on crm_pharmacies ──────────────────────────────────────────────
ALTER TABLE public.crm_pharmacies
  ADD COLUMN IF NOT EXISTS logo_url text;

-- ── 2. Recreate the membership view to include logo_url ──────────────────────
CREATE OR REPLACE VIEW public.crm_my_pharmacies AS
  SELECT m.pharmacy_id,
         m.role,
         p.name     AS pharmacy_name,
         p.logo_url AS pharmacy_logo_url
    FROM public.crm_members m
    JOIN public.crm_pharmacies p ON p.id = m.pharmacy_id
    WHERE m.user_id = auth.uid()
  UNION
  SELECT p.id AS pharmacy_id,
         'admin'::crm_member_role AS role,
         p.name     AS pharmacy_name,
         p.logo_url AS pharmacy_logo_url
    FROM public.crm_pharmacies p
    WHERE p.owner_id = auth.uid();

GRANT SELECT ON public.crm_my_pharmacies TO authenticated;

-- ── 3. Storage bucket for pharmacy logos ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-pharmacy-logos',
  'crm-pharmacy-logos',
  true,                              -- public read so the sidebar can show it
  2 * 1024 * 1024,                   -- 2 MB cap
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 4. Storage RLS policies ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY "crm_pharm_logo_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'crm-pharmacy-logos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_pharm_logo_select" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'crm-pharmacy-logos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_pharm_logo_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'crm-pharmacy-logos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_pharm_logo_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'crm-pharmacy-logos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Refresh PostgREST schema cache ────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
