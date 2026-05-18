-- ============================================================================
-- PATCH: Bill / prescription document attachments
-- ============================================================================
-- Adds a single optional attachment URL to each of crm_customer_sales and
-- crm_prescriptions, plus a public storage bucket to hold the uploaded files.
--
-- Why public bucket: WhatsApp and audit recipients need to view the original
-- bill without authenticating to Supabase. RLS on the parent tables still
-- restricts who can read the URL.
-- ============================================================================

BEGIN;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.crm_customer_sales
  ADD COLUMN IF NOT EXISTS attachment_url text;

ALTER TABLE public.crm_prescriptions
  ADD COLUMN IF NOT EXISTS attachment_url text;

-- ── 2. Storage bucket for bill / prescription scans ─────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-bill-attachments',
  'crm-bill-attachments',
  true,                                -- public read so previews work without auth
  10 * 1024 * 1024,                    -- 10 MB cap
  ARRAY['application/pdf','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── 3. Storage RLS policies ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE POLICY "crm_bill_attach_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'crm-bill-attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_bill_attach_select" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'crm-bill-attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_bill_attach_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'crm-bill-attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "crm_bill_attach_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'crm-bill-attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
