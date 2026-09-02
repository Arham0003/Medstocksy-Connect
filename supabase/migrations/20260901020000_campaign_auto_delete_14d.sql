-- Migration: 14-day automatic campaign cleanup via pg_cron
--
-- Campaigns and their recipient data are deleted 14 days after the campaign
-- was last updated (sent / scheduled_for).  crm_campaign_recipients are
-- removed via ON DELETE CASCADE already defined in 20260507_medcrm.sql.
-- crm_messages.campaign_id is SET NULL (also already defined), so customer
-- message history is preserved — only the campaign grouping is removed.
--
-- No new tables or columns are added.  We simply schedule a daily pg_cron job.
-- If pg_cron is not enabled on this Supabase project, enable it via:
--   Dashboard → Database → Extensions → pg_cron → Enable
-- or run: CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_cron if not already enabled (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing schedule with this name (safe re-run)
SELECT cron.unschedule('campaign_auto_delete_14d')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'campaign_auto_delete_14d'
);

-- Schedule: run daily at 02:00 UTC.
-- Deletes campaigns whose effective date is older than 14 days.
-- Effective date = scheduled_for if set, otherwise updated_at (covers
-- campaigns that were sent immediately without a scheduled time).
SELECT cron.schedule(
  'campaign_auto_delete_14d',
  '0 2 * * *',
  $$
  DELETE FROM public.crm_campaigns
  WHERE COALESCE(scheduled_for, updated_at) < now() - INTERVAL '14 days';
  $$
);
