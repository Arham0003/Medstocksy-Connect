-- Fix 1: Search Path Mutable
ALTER FUNCTION public.crm_set_updated_at() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

-- Fix 2: Extension in Public
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- Fix 3: Public Bucket Allows Listing (Remove broad select policies on storage.objects)
DROP POLICY IF EXISTS branding_public_read ON storage.objects;
DROP POLICY IF EXISTS crm_pharm_logo_select ON storage.objects;
DROP POLICY IF EXISTS crm_tpl_img_select ON storage.objects;

-- Fix 4: Revoke Public/Anon execute from ALL flagged functions
REVOKE EXECUTE ON FUNCTION public.crm_after_refill_insert() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_audit_trigger() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_can_send_now(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_claim_invites() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_dashboard_counts(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_get_prescriptions_for_customer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_is_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_list_customers(uuid, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_list_members(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_my_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_prune_cron_log() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crm_purge_old_audit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_audit_log_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_user_id_on_insert() FROM PUBLIC, anon;

-- Fix 5: Fully lock down internal triggers/cron functions from authenticated users too
REVOKE EXECUTE ON FUNCTION public.crm_after_refill_insert() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_audit_trigger() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_prune_cron_log() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_purge_old_audit() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_audit_log_change() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_user_id_on_insert() FROM authenticated;
