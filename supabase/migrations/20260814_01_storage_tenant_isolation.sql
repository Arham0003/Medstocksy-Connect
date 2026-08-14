-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY: tenant isolation for storage buckets
--
-- Findings (all three buckets share the same two defects)
-- --------------------------------------------------------------------------
-- 1. CRITICAL — crm-bill-attachments is `public = true` and its SELECT policy
--    is `TO public USING (bucket_id = '...')`. Bill and PRESCRIPTION scans are
--    therefore readable by anyone on the internet holding the URL, with no
--    authentication at all. Those images carry patient name, phone, doctor,
--    diagnosis and medicines — the most sensitive data in the product. The
--    URLs are stored in crm_customer_sales.attachment_url /
--    crm_prescriptions.attachment_url and are pasted into WhatsApp messages,
--    so they travel well outside the pharmacy.
--
--    The original rationale (20260510080000) was "WhatsApp recipients need to
--    view the bill without authenticating". That requirement is real, but the
--    answer is a short-lived signed URL, not a permanently world-readable
--    object.
--
-- 2. HIGH — every write policy checks ONLY bucket_id, with no path scoping:
--        FOR INSERT TO authenticated WITH CHECK (bucket_id = '...')
--        FOR UPDATE TO authenticated USING       (bucket_id = '...')
--        FOR DELETE TO authenticated USING       (bucket_id = '...')
--    Any authenticated user of ANY pharmacy can therefore overwrite or delete
--    ANY other pharmacy's bill scans, logos and template images, and can write
--    files into another pharmacy's folder. This is a cross-tenant write hole
--    that the table-level RLS never covered, because it lives in
--    storage.objects rather than the crm_* tables.
--
-- Fix
-- --------------------------------------------------------------------------
-- Every object is uploaded as `<pharmacy_id>/<filename>` (AddFromBillDialog,
-- PrescriptionWorkflow, TemplateDialog and Settings all build the path that
-- way), so the first path segment is the tenant key. Policies now require the
-- caller to be a member of that pharmacy, reusing the same crm_is_member()
-- helper the table policies use.
--
-- crm-bill-attachments additionally flips to a PRIVATE bucket; the app reads
-- it through createSignedUrl() (see src/lib/api/attachments.ts).
--
-- Logos and template images stay publicly readable on purpose: logos render in
-- the app shell before a session exists, and template images are attached to
-- outbound WhatsApp messages where the recipient has no account. Neither
-- contains patient data. Their WRITE side is still locked down here.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Helper: tenant id from an object path ───────────────────────────────────
-- Returns the leading `<pharmacy_id>/` segment as a uuid, or NULL when the
-- path has no folder or the folder is not a uuid. Returning NULL (rather than
-- raising) matters: a policy that throws would surface as a 500 on unrelated
-- uploads, whereas NULL simply fails the membership test and denies access.
CREATE OR REPLACE FUNCTION public.crm_storage_tenant(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first text;
BEGIN
  v_first := split_part(p_name, '/', 1);
  IF v_first IS NULL OR v_first = '' OR v_first = p_name THEN
    RETURN NULL;   -- no folder component at all
  END IF;
  RETURN v_first::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;     -- folder present but not a uuid
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_storage_tenant(text) TO authenticated, anon;


-- ── 1. Bills / prescription scans → PRIVATE + member-only ───────────────────
UPDATE storage.buckets SET public = false WHERE id = 'crm-bill-attachments';

DROP POLICY IF EXISTS "crm_bill_attach_insert" ON storage.objects;
DROP POLICY IF EXISTS "crm_bill_attach_select" ON storage.objects;
DROP POLICY IF EXISTS "crm_bill_attach_update" ON storage.objects;
DROP POLICY IF EXISTS "crm_bill_attach_delete" ON storage.objects;

CREATE POLICY "crm_bill_attach_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'crm-bill-attachments'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_bill_attach_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-bill-attachments'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_bill_attach_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crm-bill-attachments'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  )
  WITH CHECK (
    bucket_id = 'crm-bill-attachments'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_bill_attach_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-bill-attachments'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );


-- ── 2. Pharmacy logos — public read, member-only write ──────────────────────
DROP POLICY IF EXISTS "crm_pharm_logo_insert" ON storage.objects;
DROP POLICY IF EXISTS "crm_pharm_logo_update" ON storage.objects;
DROP POLICY IF EXISTS "crm_pharm_logo_delete" ON storage.objects;
-- SELECT policy intentionally left as-is: the logo renders in the app shell
-- before a session exists, and it carries no patient data.

CREATE POLICY "crm_pharm_logo_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-pharmacy-logos'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_pharm_logo_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crm-pharmacy-logos'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  )
  WITH CHECK (
    bucket_id = 'crm-pharmacy-logos'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_pharm_logo_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-pharmacy-logos'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );


-- ── 3. Template images — public read, member-only write ─────────────────────
DROP POLICY IF EXISTS "crm_tpl_img_insert" ON storage.objects;
DROP POLICY IF EXISTS "crm_tpl_img_update" ON storage.objects;
DROP POLICY IF EXISTS "crm_tpl_img_delete" ON storage.objects;
-- SELECT stays public: these images are attached to outbound WhatsApp
-- messages, where the recipient has no Supabase session.

CREATE POLICY "crm_tpl_img_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-template-images'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_tpl_img_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crm-template-images'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  )
  WITH CHECK (
    bucket_id = 'crm-template-images'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

CREATE POLICY "crm_tpl_img_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-template-images'
    AND public.crm_is_member(public.crm_storage_tenant(name))
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
