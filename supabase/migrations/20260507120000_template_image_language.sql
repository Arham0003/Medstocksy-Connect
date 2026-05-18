-- ============================================================================
-- PATCH: Add language + image support to message templates
-- ============================================================================
-- Adds:
--   • crm_templates.language ('en' | 'hi') — single-language per template
--   • crm_templates.image_url (nullable) — optional image attached to message
--   • Supabase Storage bucket 'crm-template-images' with public-read policies
--
-- Run in: https://supabase.com/dashboard/project/ypeopwzkemqlgvvgyhcw/sql/new
-- ============================================================================

BEGIN;

-- ── 1. Columns on crm_templates ──────────────────────────────────────────────
ALTER TABLE public.crm_templates
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

ALTER TABLE public.crm_templates
  ADD COLUMN IF NOT EXISTS image_url text;

-- Constraint: language must be one of the supported codes
DO $$ BEGIN
  ALTER TABLE public.crm_templates
    ADD CONSTRAINT crm_templates_language_chk CHECK (language IN ('en', 'hi'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation THEN
    RAISE NOTICE 'Some templates have language outside (en, hi) — fixing them to en';
    UPDATE public.crm_templates SET language = 'en' WHERE language NOT IN ('en', 'hi');
    -- Re-attempt
    ALTER TABLE public.crm_templates
      ADD CONSTRAINT crm_templates_language_chk CHECK (language IN ('en', 'hi'));
END $$;

-- ── 2. Storage bucket for template images ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-template-images',
  'crm-template-images',
  true,                                -- public read so WhatsApp media URL works
  5 * 1024 * 1024,                     -- 5 MB cap (WhatsApp limit for images)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 3. Storage RLS policies ──────────────────────────────────────────────────
-- Authenticated users can upload to this bucket. RLS on crm_templates
-- (where the URL ultimately lives) enforces multi-tenant isolation.
DO $$ BEGIN
  CREATE POLICY "crm_tpl_img_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'crm-template-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_tpl_img_select" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'crm-template-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_tpl_img_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'crm-template-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_tpl_img_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'crm-template-images');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 4. Refresh PostgREST schema cache ────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (run separately):
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='crm_templates'
--     AND column_name IN ('language','image_url');
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id='crm-template-images';
