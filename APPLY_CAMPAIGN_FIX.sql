-- ═══════════════════════════════════════════════════════════════════════════
-- CAMPAIGN DELETE FIX — run once in Supabase SQL Editor
--
-- Fixes two bugs:
--   1. Manual delete silently fails (missing RLS DELETE policy on crm_campaigns)
--   2. 14-day auto-delete pg_cron job not scheduled
--
-- Both statements are idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1: Add DELETE RLS policy for crm_campaigns
--
-- The initial migration defined SELECT, INSERT, UPDATE but omitted DELETE.
-- With RLS enabled, a missing DELETE policy means the client DELETE call
-- returns HTTP 200 but removes nothing — silent failure.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS campaigns_delete ON public.crm_campaigns;
CREATE POLICY campaigns_delete ON public.crm_campaigns
  FOR DELETE TO authenticated
  USING (public.crm_is_member(pharmacy_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2: Schedule pg_cron job for 14-day auto-delete
--
-- Deletes campaigns (and CASCADE removes crm_campaign_recipients) whose
-- effective date is older than 14 days.
-- Requires pg_cron extension. Enable via:
--   Dashboard → Database → Extensions → pg_cron → Enable
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove old schedule if it exists (safe re-run)
SELECT cron.unschedule('campaign_auto_delete_14d')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'campaign_auto_delete_14d'
);

-- Schedule daily at 02:00 UTC
SELECT cron.schedule(
  'campaign_auto_delete_14d',
  '0 2 * * *',
  $$
  DELETE FROM public.crm_campaigns
  WHERE COALESCE(scheduled_for, updated_at) < now() - INTERVAL '14 days';
  $$
);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — run this separately after COMMIT to confirm both fixes are live
-- ─────────────────────────────────────────────────────────────────────────────
-- Check DELETE policy exists:
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'crm_campaigns' AND cmd = 'DELETE';

-- Check cron job scheduled:
SELECT jobname, schedule, command FROM cron.job
WHERE jobname = 'campaign_auto_delete_14d';
