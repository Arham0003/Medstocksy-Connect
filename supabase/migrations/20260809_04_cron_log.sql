-- ═══════════════════════════════════════════════════════════════════════
-- Cron run log  (audit §5 schema gaps: "No crm_cron_log table")
--
-- Auto-dispatch runs unattended, so without a record of each run the only
-- way to tell "no reminders were due" apart from "the job stopped firing
-- three days ago" is to notice patients complaining. Every invocation writes
-- one row here, successful or not.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crm_cron_log (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job           text        NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  ok            boolean     NOT NULL DEFAULT false,
  processed     integer     NOT NULL DEFAULT 0,
  sent          integer     NOT NULL DEFAULT 0,
  failed        integer     NOT NULL DEFAULT 0,
  skipped       integer     NOT NULL DEFAULT 0,
  error_message text,
  -- Per-pharmacy breakdown so one tenant's WABA outage is visible without
  -- reading application logs.
  detail        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_crm_cron_log_job_time
  ON public.crm_cron_log (job, started_at DESC);

ALTER TABLE public.crm_cron_log ENABLE ROW LEVEL SECURITY;

-- No policy for `authenticated`: rows are cross-tenant, so they are written
-- and read only by the service role (which bypasses RLS). Enabling RLS with
-- zero policies is the deny-all default and is deliberate here.

COMMENT ON TABLE public.crm_cron_log IS
  'One row per scheduled-job invocation. Service-role only; RLS denies all client access.';


-- ── Failure reason on scheduled reminders ───────────────────────────────
-- The Reminders page has a "Failed" tab with a Retry button but no way to
-- show WHY a send failed (bad number vs. template rejected vs. token
-- expired), because the row had nowhere to record it. Auto-dispatch makes
-- that worse: nobody is watching at the moment of failure.
ALTER TABLE public.crm_scheduled_reminders
  ADD COLUMN IF NOT EXISTS error_message text;


-- ── Retention ───────────────────────────────────────────────────────────
-- Matches the 90-day policy already used for crm_audit_log.
CREATE OR REPLACE FUNCTION public.crm_prune_cron_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.crm_cron_log WHERE started_at < now() - interval '90 days';
$$;
