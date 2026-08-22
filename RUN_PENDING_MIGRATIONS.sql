-- ═══════════════════════════════════════════════════════════════════════════
-- Medstocksy Connect — ALL PENDING MIGRATIONS  (generated 2026-08-14)
--
--   ⚠  THIS IS NOT APPLY_ALL.sql.
--      APPLY_ALL.sql is the fresh-project bootstrap. Despite its header it is
--      NOT safe on a populated database: it DELETEs duplicate pharmacies, and
--      13 tables cascade off crm_pharmacies, so it can wipe customers, sales,
--      prescriptions and messages. Do not run it. Run THIS file.
--
-- Paste this whole file into the Supabase SQL Editor and Run once.
--
-- Contains the six unapplied migrations, in dependency order. The other 26
-- files in supabase/migrations/ are excluded on purpose: two are byte-identical
-- copies of the initial schema, and two mutate data (one DELETEs duplicate
-- reminder rows and is meant to be run by hand after reviewing its PREVIEW
-- companion). Never use `supabase db push` on this project — with an empty
-- remote migration history it would attempt all 32.
--
-- Every statement is idempotent (CREATE OR REPLACE / IF NOT EXISTS /
-- DROP POLICY IF EXISTS), so re-running is harmless.
--
-- Wrapped in ONE transaction: if any statement fails, everything rolls back
-- and the database is left exactly as it was. The per-file BEGIN;/COMMIT;
-- markers have been stripped so this is a single atomic unit.
--
-- ── DEPLOY ORDER MATTERS ───────────────────────────────────────────────────
-- Part 5 makes the bill-attachment bucket PRIVATE. Existing attachment_url
-- rows hold public URLs that stop resolving. The app handles both old and new
-- forms via src/lib/api/attachments.ts, so SHIP THE APP CODE FIRST (or at the
-- same time) — otherwise attachment links break until the deploy lands.
--
-- Verification query is at the bottom, after COMMIT. Run it separately.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;


-- ###########################################################################
-- PART 1 of 6 — SECURITY: tenant guards on SECURITY DEFINER RPCs
-- source: supabase/migrations/20260809_01_rpc_tenant_guards.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- SECURITY FIX: add tenant-membership guards to SECURITY DEFINER RPCs
--
-- Problem
-- -------
-- crm_dashboard_counts, crm_get_prescriptions_for_customer and
-- crm_list_customers are all SECURITY DEFINER and accept a tenant id
-- (or a customer id) straight from the client, with no check that the
-- caller belongs to that tenant.
--
-- SECURITY DEFINER executes as the function OWNER, which means row-level
-- security on the underlying tables is NOT applied. (The comment in
-- 20260610_02 — "RLS inside function checks via SECURITY DEFINER context"
-- — has it backwards: DEFINER bypasses RLS rather than enforcing it.)
--
-- Net effect: any authenticated user of ANY pharmacy could call
--   supabase.rpc('crm_list_customers', { p_pharmacy_id: '<other tenant>' })
-- and read another pharmacy's full customer list, dashboard totals and
-- prescription history. The RLS policies added in 20260507 never applied
-- to these paths.
--
-- Fix
-- ---
-- Reuse the existing crm_is_member() helper (20260507_medcrm.sql:504) that
-- the RLS policies already rely on. Bodies below are unchanged apart from
-- the added guard, and each function keeps its current signature so no
-- client change is required.
--
-- Also adds SET search_path = public, pg_temp to each. SECURITY DEFINER
-- functions without a pinned search_path are vulnerable to search-path
-- shadowing; the 20260507 functions set it, these three never did.
--
-- Behaviour on failure: raise, not return-empty. A silent empty result
-- would look identical to "this pharmacy has no customers" and hide the
-- misconfiguration.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. crm_dashboard_counts ─────────────────────────────────────────────
-- Body copied verbatim from 20260627_01_fix_dashboard_counts_overdue.sql.
CREATE OR REPLACE FUNCTION crm_dashboard_counts(p_pharmacy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz            text        := 'Asia/Kolkata';
  v_now           timestamptz := now() AT TIME ZONE v_tz;
  v_today_start   timestamptz := date_trunc('day',   v_now) AT TIME ZONE v_tz;
  v_today_end     timestamptz := v_today_start + interval '1 day';
  v_yesterday_s   timestamptz := v_today_start - interval '1 day';
  v_month_start   timestamptz := date_trunc('month', v_now) AT TIME ZONE v_tz;
  v_7d_ago        timestamptz := now() - interval '7 days';
  v_next_7d       timestamptz := now() + interval '7 days';
BEGIN
  IF NOT public.crm_is_member(p_pharmacy_id) THEN
    RAISE EXCEPTION 'not a member of pharmacy %', p_pharmacy_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN jsonb_build_object(
    -- KPI tile 1: Total customers + new this week
    'total_customers',    (SELECT count(*) FROM crm_customers       WHERE pharmacy_id = p_pharmacy_id),
    'this_week',          (SELECT count(*) FROM crm_customers       WHERE pharmacy_id = p_pharmacy_id AND created_at >= v_7d_ago),

    -- KPI tile 2: Pending reminders (ALL pending, including overdue)
    'today_pending',      (SELECT count(*) FROM crm_scheduled_reminders WHERE pharmacy_id = p_pharmacy_id AND status = 'pending'),
    'today_sent',         (SELECT count(*) FROM crm_scheduled_reminders WHERE pharmacy_id = p_pharmacy_id AND status = 'sent'
                              AND sent_at BETWEEN v_today_start AND v_today_end),

    -- KPI tile 3: Visits this month
    'visits_month',       (SELECT count(*) FROM crm_customer_sales  WHERE pharmacy_id = p_pharmacy_id AND sold_at >= v_month_start),

    -- KPI tile 4: Chronic patients
    'chronic_count',      (SELECT count(*) FROM crm_tags            WHERE pharmacy_id = p_pharmacy_id AND tag_key = 'chronic'),

    -- Right-rail counter: all pending (overdue + upcoming) — matches bell count
    'upcoming_7d',        (SELECT count(*) FROM crm_scheduled_reminders WHERE pharmacy_id = p_pharmacy_id AND status = 'pending'),

    -- TodaysPulse: revenue today
    'revenue_today',      COALESCE(
                            (SELECT sum(bill_amount) FROM crm_customer_sales       WHERE pharmacy_id = p_pharmacy_id AND sold_at       BETWEEN v_today_start AND v_today_end), 0) +
                          COALESCE(
                            (SELECT sum(bill_amount) FROM crm_prescription_refills WHERE pharmacy_id = p_pharmacy_id AND refilled_at   BETWEEN v_today_start AND v_today_end), 0),

    -- TodaysPulse: revenue yesterday (for delta %)
    'revenue_yesterday',  COALESCE(
                            (SELECT sum(bill_amount) FROM crm_customer_sales       WHERE pharmacy_id = p_pharmacy_id AND sold_at       BETWEEN v_yesterday_s AND v_today_start), 0) +
                          COALESCE(
                            (SELECT sum(bill_amount) FROM crm_prescription_refills WHERE pharmacy_id = p_pharmacy_id AND refilled_at   BETWEEN v_yesterday_s AND v_today_start), 0),

    -- TodaysPulse mini-stats
    'new_customers_today',(SELECT count(*) FROM crm_customers              WHERE pharmacy_id = p_pharmacy_id AND created_at BETWEEN v_today_start AND v_today_end),
    'msgs_out_today',     (SELECT count(*) FROM crm_messages               WHERE pharmacy_id = p_pharmacy_id AND direction = 'outbound' AND created_at BETWEEN v_today_start AND v_today_end),
    'refills_today',      (SELECT count(*) FROM crm_prescription_refills   WHERE pharmacy_id = p_pharmacy_id AND refilled_at BETWEEN v_today_start AND v_today_end),
    'reminders_due_today',(SELECT count(*) FROM crm_scheduled_reminders    WHERE pharmacy_id = p_pharmacy_id AND status = 'pending'
                              AND scheduled_for < v_today_end)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crm_dashboard_counts(uuid) TO authenticated;


-- ── 2. crm_get_prescriptions_for_customer ───────────────────────────────
-- Takes a customer id rather than a pharmacy id, so the guard resolves the
-- owning pharmacy from the prescription row itself. Expressed as an extra
-- WHERE predicate to keep the function LANGUAGE sql (no plpgsql rewrite).
-- crm_prescriptions.pharmacy_id is NOT NULL (20260510020000:22), so the
-- predicate can never be skipped by a null.
CREATE OR REPLACE FUNCTION crm_get_prescriptions_for_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(rx_with_meds ORDER BY rx_with_meds->>'prescription_date' DESC), '[]'::jsonb)
  FROM (
    SELECT
      to_jsonb(p) ||
      jsonb_build_object(
        'medicines', COALESCE(
          (
            SELECT jsonb_agg(
              to_jsonb(m) ||
              jsonb_build_object(
                'refill_stats', jsonb_build_object(
                  'count',            COALESCE(r.refill_count, 0),
                  'last_refilled_at', r.last_refilled_at::text,
                  'next_due_at',
                    CASE
                      WHEN r.last_refilled_at IS NOT NULL
                        AND COALESCE(m.refill_interval_days, 0) > 0
                      THEN (r.last_refilled_at +
                            (m.refill_interval_days::text || ' days')::interval)::text
                    END
                )
              )
              ORDER BY m.position
            )
            FROM  crm_prescription_medicines m
            LEFT JOIN LATERAL (
              SELECT
                count(*)::int           AS refill_count,
                max(refilled_at)        AS last_refilled_at
              FROM crm_prescription_refills
              WHERE medicine_id = m.id
            ) r ON TRUE
            WHERE m.prescription_id = p.id
          ),
          '[]'::jsonb
        )
      ) AS rx_with_meds
    FROM crm_prescriptions p
    WHERE p.customer_id = p_customer_id
      AND public.crm_is_member(p.pharmacy_id)   -- ← tenant guard
    ORDER BY p.prescription_date DESC
    LIMIT 50
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION crm_get_prescriptions_for_customer(uuid) TO authenticated;


-- ── 3. crm_list_customers ───────────────────────────────────────────────
-- Guard only; the body is unchanged from 20260610_05_list_customers_fn.sql.
CREATE OR REPLACE FUNCTION crm_list_customers(
  p_pharmacy_id uuid,
  p_segment     text    DEFAULT 'all',
  p_search      text    DEFAULT NULL,
  p_sort        text    DEFAULT 'newest',
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT public.crm_is_member(p_pharmacy_id) THEN
    RAISE EXCEPTION 'not a member of pharmacy %', p_pharmacy_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*)
  INTO   v_total
  FROM   crm_customers_enriched e
  WHERE  e.pharmacy_id = p_pharmacy_id
    AND  (
           p_segment = 'all'
        OR (p_segment = 'optout'    AND e.whatsapp_opted_in = false)
        OR (p_segment = 'chronic'   AND EXISTS (
              SELECT 1 FROM crm_tags t
              WHERE t.customer_id = e.id AND t.tag_key = 'chronic'
           ))
        OR e.auto_tags_json ? p_segment
         )
    AND  (
           p_search IS NULL
        OR e.fts @@ plainto_tsquery('simple', p_search)
        OR e.phone ILIKE '%' || p_search || '%'
         );

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO   v_rows
  FROM  (
    SELECT to_jsonb(e.*) AS row_data
    FROM   crm_customers_enriched e
    WHERE  e.pharmacy_id = p_pharmacy_id
      AND  (
             p_segment = 'all'
          OR (p_segment = 'optout'    AND e.whatsapp_opted_in = false)
          OR (p_segment = 'chronic'   AND EXISTS (
                SELECT 1 FROM crm_tags t
                WHERE t.customer_id = e.id AND t.tag_key = 'chronic'
             ))
          OR e.auto_tags_json ? p_segment
           )
      AND  (
             p_search IS NULL
          OR e.fts @@ plainto_tsquery('simple', p_search)
          OR e.phone ILIKE '%' || p_search || '%'
           )
    ORDER BY
      CASE WHEN p_sort = 'newest'       THEN e.created_at        END DESC NULLS LAST,
      CASE WHEN p_sort = 'oldest'       THEN e.created_at        END ASC  NULLS LAST,
      CASE WHEN p_sort = 'name'         THEN e.name              END ASC  NULLS LAST,
      CASE WHEN p_sort = 'recent_visit' THEN e.last_visit_at     END DESC NULLS LAST,
      CASE WHEN p_sort = 'top_spend'    THEN e.lifetime_value    END DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'total', v_total,
    'rows',  v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION crm_list_customers(uuid, text, text, text, integer, integer) TO authenticated;


-- ###########################################################################
-- PART 2 of 6 — Staff invites + member directory
-- source: supabase/migrations/20260809_02_staff_invites.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Staff invites + member directory  (audit Phase 1 #3)
--
-- Context: crm_members.user_id references auth.users, so adding staff means
-- knowing a user id that does not exist until that person signs up. Creating
-- the account outright needs the service-role key via the Auth admin API,
-- which the browser must never hold.
--
-- So invites are claim-on-signup instead:
--   1. An admin records an invite (pharmacy + email + role).
--   2. The invitee signs up normally with that email.
--   3. On first load the app calls crm_claim_invites(), which turns any
--      pending invite matching their verified email into a crm_members row.
--
-- No secret token is needed: the match is on the email Supabase Auth has
-- already verified, so an invite cannot be claimed by anyone else.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crm_invites (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id  uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         crm_member_role NOT NULL DEFAULT 'staff',
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Emails are matched case-insensitively, so store and index them folded.
-- Partial unique index: only ONE pending invite per email per pharmacy, but
-- re-inviting someone after they leave is still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_invites_pending
  ON public.crm_invites (pharmacy_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_invites_email
  ON public.crm_invites (lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE public.crm_invites ENABLE ROW LEVEL SECURITY;

-- Members can see their pharmacy's invites; only admins may create/revoke.
DROP POLICY IF EXISTS invites_select ON public.crm_invites;
CREATE POLICY invites_select ON public.crm_invites FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS invites_admin_write ON public.crm_invites;
CREATE POLICY invites_admin_write ON public.crm_invites FOR ALL TO authenticated
  USING (public.crm_my_role(pharmacy_id) = 'admin')
  WITH CHECK (public.crm_my_role(pharmacy_id) = 'admin');


-- ── Member directory ────────────────────────────────────────────────────
-- crm_members stores only user_id; the email lives in auth.users, which is
-- not exposed to the anon/authenticated roles. This function joins the two
-- and returns ONLY the rows for a pharmacy the caller belongs to.
CREATE OR REPLACE FUNCTION public.crm_list_members(p_pharmacy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_members jsonb;
  v_invites jsonb;
BEGIN
  IF NOT public.crm_is_member(p_pharmacy_id) THEN
    RAISE EXCEPTION 'not a member of pharmacy %', p_pharmacy_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY m->>'joined_at'), '[]'::jsonb)
  INTO   v_members
  FROM (
    SELECT jsonb_build_object(
             'id',        mem.id,
             'user_id',   mem.user_id,
             'email',     u.email,
             'role',      mem.role,
             'joined_at', mem.joined_at,
             'is_owner',  (ph.owner_id = mem.user_id),
             'is_self',   (mem.user_id = auth.uid())
           ) AS m
    FROM      public.crm_members    mem
    JOIN      public.crm_pharmacies ph ON ph.id = mem.pharmacy_id
    LEFT JOIN auth.users            u  ON u.id  = mem.user_id
    WHERE     mem.pharmacy_id = p_pharmacy_id
  ) sub;

  SELECT COALESCE(jsonb_agg(i ORDER BY i->>'created_at' DESC), '[]'::jsonb)
  INTO   v_invites
  FROM (
    SELECT jsonb_build_object(
             'id',         inv.id,
             'email',      inv.email,
             'role',       inv.role,
             'created_at', inv.created_at
           ) AS i
    FROM   public.crm_invites inv
    WHERE  inv.pharmacy_id = p_pharmacy_id
      AND  inv.accepted_at IS NULL
  ) sub2;

  RETURN jsonb_build_object('members', v_members, 'invites', v_invites);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_list_members(uuid) TO authenticated;


-- ── Claim invites ───────────────────────────────────────────────────────
-- Called by the app after login. Converts every pending invite addressed to
-- the caller's own verified email into a membership. Returns how many were
-- claimed so the UI can refresh the pharmacy list when it is non-zero.
CREATE OR REPLACE FUNCTION public.crm_claim_invites()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email    text;
  v_uid      uuid := auth.uid();
  v_claimed  integer := 0;
  v_invite   record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  -- Read the email straight from auth.users rather than trusting a parameter,
  -- and only when it is confirmed — an unverified address must not be able to
  -- claim someone else's invite.
  SELECT lower(email) INTO v_email
  FROM   auth.users
  WHERE  id = v_uid
    AND  email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_invite IN
    SELECT * FROM public.crm_invites
    WHERE  accepted_at IS NULL
      AND  lower(email) = v_email
  LOOP
    -- ON CONFLICT: already a member of that pharmacy (e.g. invited twice, or
    -- invited after already joining). Still mark the invite consumed.
    INSERT INTO public.crm_members (pharmacy_id, user_id, role, invited_by)
    VALUES (v_invite.pharmacy_id, v_uid, v_invite.role, v_invite.invited_by)
    ON CONFLICT (pharmacy_id, user_id) DO NOTHING;

    UPDATE public.crm_invites
    SET    accepted_at = now(), accepted_by = v_uid
    WHERE  id = v_invite.id;

    v_claimed := v_claimed + 1;
  END LOOP;

  RETURN v_claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_claim_invites() TO authenticated;


-- ###########################################################################
-- PART 3 of 6 — Configurable segment thresholds
-- source: supabase/migrations/20260809_03_configurable_thresholds.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════
-- Configurable segment thresholds  (audit Phase 1 #8)
--
-- crm_customer_auto_tags hardcoded three numbers (20260507_medcrm.sql:470):
--   new         created_at > now() - interval '7 days'
--   high_value  lifetime_value >= 10000
--   inactive    last_visit_at  < now() - interval '30 days'
--
-- ₹10,000 lifetime spend is a rounding error for a chronic-care pharmacy and
-- a whale for a small counter shop, and 30 days is far too eager in either.
-- Because the thresholds drive the segment chips, the Segments page and
-- campaign audiences, one hardcoded guess makes those features wrong for
-- most tenants. Move them onto crm_pharmacies so each owner sets their own.
--
-- Defaults are exactly the old constants, so applying this migration changes
-- no existing behaviour until someone edits the values.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.crm_pharmacies
  ADD COLUMN IF NOT EXISTS new_customer_days   integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS inactive_days       integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS high_value_amount   numeric(12,2) NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS repeat_min_visits   integer NOT NULL DEFAULT 2;

-- Guard rails: a zero or negative window would tag every customer at once,
-- and the UI offers bounded choices anyway.
ALTER TABLE public.crm_pharmacies
  DROP CONSTRAINT IF EXISTS crm_pharmacies_threshold_sanity;
ALTER TABLE public.crm_pharmacies
  ADD CONSTRAINT crm_pharmacies_threshold_sanity CHECK (
    new_customer_days BETWEEN 1 AND 365
    AND inactive_days BETWEEN 7 AND 3650
    AND high_value_amount >= 0
    AND repeat_min_visits BETWEEN 2 AND 100
  );

COMMENT ON COLUMN public.crm_pharmacies.new_customer_days IS
  'Days after signup a customer still counts as "new".';
COMMENT ON COLUMN public.crm_pharmacies.inactive_days IS
  'Days since last visit before a customer counts as "inactive".';
COMMENT ON COLUMN public.crm_pharmacies.high_value_amount IS
  'Lifetime spend (INR) at which a customer counts as "high value".';
COMMENT ON COLUMN public.crm_pharmacies.repeat_min_visits IS
  'Visit count at which a customer counts as "repeat".';


-- ── Rebuild the auto-tag view against per-pharmacy thresholds ────────────
-- Each branch joins crm_pharmacies so the comparison uses that tenant's
-- configured value. `make_interval(days => ...)` is used rather than string
-- concatenation into ::interval — it takes an integer directly and cannot be
-- turned into an injection vector by a bad column value.
CREATE OR REPLACE VIEW public.crm_customer_auto_tags AS
WITH stats AS (SELECT * FROM public.crm_customer_stats)
SELECT c.id AS customer_id, c.pharmacy_id, 'new'::text AS tag
  FROM public.crm_customers  c
  JOIN public.crm_pharmacies p ON p.id = c.pharmacy_id
  WHERE c.created_at > now() - make_interval(days => p.new_customer_days)
UNION ALL
SELECT s.customer_id, s.pharmacy_id, 'repeat'
  FROM stats s
  JOIN public.crm_pharmacies p ON p.id = s.pharmacy_id
  WHERE s.visit_count >= p.repeat_min_visits
UNION ALL
SELECT s.customer_id, s.pharmacy_id, 'high_value'
  FROM stats s
  JOIN public.crm_pharmacies p ON p.id = s.pharmacy_id
  WHERE s.lifetime_value >= p.high_value_amount
UNION ALL
SELECT s.customer_id, s.pharmacy_id, 'inactive'
  FROM stats s
  JOIN public.crm_pharmacies p ON p.id = s.pharmacy_id
  WHERE s.last_visit_at IS NOT NULL
    AND s.last_visit_at < now() - make_interval(days => p.inactive_days);


-- ###########################################################################
-- PART 4 of 6 — Cron run log + reminder failure reason
-- source: supabase/migrations/20260809_04_cron_log.sql
-- ###########################################################################

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


-- ###########################################################################
-- PART 5 of 6 — SECURITY: storage bucket tenant isolation
-- source: supabase/migrations/20260814_01_storage_tenant_isolation.sql
-- ###########################################################################

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


-- ###########################################################################
-- PART 6 of 6 — Prescription-first reminders + medicine override
-- source: supabase/migrations/20260814_02_medicine_reminder_override.sql
-- ###########################################################################

-- ═══════════════════════════════════════════════════════════════════════════
-- Prescription-first reminders + optional medicine-level override
--
-- Current state (verified before changing anything, per the spec's §5):
--   • scheduleRefillReminders() already emits ONE reminder per prescription,
--     anchored on the shortest refill interval — the "5 medicines → 5
--     reminders" problem is already solved at creation time.
--   • crm_scheduled_reminders.prescription_id exists with ON DELETE CASCADE
--     (20260628_01), so deleting a prescription cannot orphan reminders.
--   • crm_after_refill_insert() dedupes per (customer, prescription, day),
--     appending medicine names to an existing pending row.
--
-- What was missing: the medicine-level OVERRIDE described in §2. Every
-- medicine was forced to follow the prescription's single schedule, with no
-- way to say "Medicine B needs a different cadence".
--
-- Model
--   crm_scheduled_reminders.medicine_id IS NULL  → prescription-level (default)
--   crm_scheduled_reminders.medicine_id IS SET   → override for that medicine
--
--   crm_prescription_medicines.reminder_override = true opts a medicine OUT of
--   the prescription-level reminder and INTO its own schedule. Priority is
--   therefore exactly the spec's model:
--     1. medicine override, when reminder_override = true
--     2. prescription-level reminder, otherwise
--     3. nothing, when no interval is set anywhere
--
--   Because override medicines are excluded from the prescription-level
--   aggregate, the two can never both fire for the same medicine.
--
-- Also fixes: crm_after_refill_insert() was SECURITY DEFINER with no
-- `SET search_path`, which Supabase's Security Advisor flags as "Function
-- Search Path Mutable" — a definer function resolving unqualified names
-- through a caller-controlled search_path is a privilege-escalation vector.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Schema ───────────────────────────────────────────────────────────────
ALTER TABLE public.crm_scheduled_reminders
  ADD COLUMN IF NOT EXISTS medicine_id uuid
    REFERENCES public.crm_prescription_medicines(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.crm_scheduled_reminders.medicine_id IS
  'NULL = prescription-level reminder (default). Set = override for one medicine.';

ALTER TABLE public.crm_prescription_medicines
  ADD COLUMN IF NOT EXISTS reminder_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.crm_prescription_medicines.reminder_override IS
  'true = this medicine has its own reminder schedule and is excluded from the '
  'prescription-level reminder.';

CREATE INDEX IF NOT EXISTS idx_crm_sched_medicine
  ON public.crm_scheduled_reminders(medicine_id)
  WHERE medicine_id IS NOT NULL;

-- Duplicate guard. One pending prescription-level reminder per prescription
-- per day, and one pending override per medicine per day. Partial unique
-- indexes because the rule only applies to rows still waiting to be sent —
-- historical sent/failed rows must be free to repeat.
--
-- COALESCE is not usable in a unique index predicate across NULLs, so the two
-- cases get separate indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sched_pending_prescription
  ON public.crm_scheduled_reminders (
    prescription_id,
    ((scheduled_for AT TIME ZONE 'Asia/Kolkata')::date)
  )
  WHERE status = 'pending' AND medicine_id IS NULL AND prescription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sched_pending_medicine
  ON public.crm_scheduled_reminders (
    medicine_id,
    ((scheduled_for AT TIME ZONE 'Asia/Kolkata')::date)
  )
  WHERE status = 'pending' AND medicine_id IS NOT NULL;


-- ── 2. Refill trigger — override-aware, search_path pinned ──────────────────
CREATE OR REPLACE FUNCTION crm_after_refill_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_med_name        text;
  v_interval        integer;
  v_override        boolean;
  v_tpl_id          uuid;
  v_when            timestamptz;
  v_when_day        date;
  v_existing_id     uuid;
  v_existing_med    text;
  v_prescription_id uuid;
BEGIN
  SELECT pm.medicine_name,
         COALESCE(pm.refill_interval_days, 0),
         COALESCE(pm.reminder_override, false),
         pm.prescription_id
  INTO   v_med_name, v_interval, v_override, v_prescription_id
  FROM   crm_prescription_medicines pm
  WHERE  pm.id = NEW.medicine_id;

  IF v_interval <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_tpl_id
  FROM   crm_templates
  WHERE  kind = 'refill_reminder'
    AND  (pharmacy_id IS NULL OR pharmacy_id = NEW.pharmacy_id)
  ORDER BY is_built_in DESC
  LIMIT  1;

  IF v_tpl_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_when := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata' +
            (GREATEST(v_interval - 5, 1) || ' days')::interval)
            + interval '9 hours';
  v_when := v_when AT TIME ZONE 'Asia/Kolkata';
  v_when_day := (v_when AT TIME ZONE 'Asia/Kolkata')::date;

  IF v_override THEN
    -- Medicine manages its own schedule: never merge it into the shared row.
    SELECT id INTO v_existing_id
    FROM   crm_scheduled_reminders
    WHERE  medicine_id = NEW.medicine_id
      AND  status      = 'pending'
      AND  (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date = v_when_day
    LIMIT  1;

    IF v_existing_id IS NULL THEN
      INSERT INTO crm_scheduled_reminders
        (pharmacy_id, customer_id, prescription_id, medicine_id,
         template_id, scheduled_for, variables)
      VALUES
        (NEW.pharmacy_id, NEW.customer_id, v_prescription_id, NEW.medicine_id,
         v_tpl_id, v_when, jsonb_build_object('medicine', v_med_name));
    END IF;

    RETURN NEW;
  END IF;

  -- Default path: fold into the prescription-level reminder for that day.
  -- medicine_id IS NULL keeps override rows out of this match.
  SELECT id, (variables->>'medicine')
  INTO   v_existing_id, v_existing_med
  FROM   crm_scheduled_reminders
  WHERE  pharmacy_id     = NEW.pharmacy_id
    AND  customer_id     = NEW.customer_id
    AND  prescription_id = v_prescription_id
    AND  medicine_id IS NULL
    AND  status          = 'pending'
    AND  (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date = v_when_day
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Only append when the medicine is not already listed, so repeated
    -- refills of the same medicine cannot grow "Metformin, Metformin, …".
    IF position(v_med_name IN COALESCE(v_existing_med, '')) = 0 THEN
      UPDATE crm_scheduled_reminders
      SET    variables = jsonb_set(
                           variables, '{medicine}',
                           to_jsonb(COALESCE(v_existing_med || ', ', '') || v_med_name)
                         )
      WHERE  id = v_existing_id;
    END IF;
  ELSE
    INSERT INTO crm_scheduled_reminders
      (pharmacy_id, customer_id, prescription_id, template_id, scheduled_for, variables)
    VALUES
      (NEW.pharmacy_id, NEW.customer_id, v_prescription_id, v_tpl_id, v_when,
       jsonb_build_object('medicine', v_med_name));
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- Lost a race against the partial unique index; the other transaction
    -- already scheduled this reminder. Not an error.
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE WARNING '[crm_after_refill_insert] reminder scheduling failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_refill_schedule ON crm_prescription_refills;

CREATE TRIGGER trg_crm_refill_schedule
  AFTER INSERT ON crm_prescription_refills
  FOR EACH ROW
  EXECUTE FUNCTION crm_after_refill_insert();

NOTIFY pgrst, 'reload schema';


COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — run separately after the transaction above commits.
-- Expect 9 rows, every ok = true.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- select 'guard: crm_list_customers' as check,
--        prosecdef and prosrc like '%crm_is_member%' as ok
--   from pg_proc where proname = 'crm_list_customers'
-- union all
-- select 'guard: crm_dashboard_counts',
--        prosecdef and prosrc like '%crm_is_member%'
--   from pg_proc where proname = 'crm_dashboard_counts'
-- union all
-- select 'search_path: crm_after_refill_insert',
--        proconfig is not null
--   from pg_proc where proname = 'crm_after_refill_insert'
-- union all
-- select 'table: crm_invites',  to_regclass('public.crm_invites')  is not null
-- union all
-- select 'table: crm_cron_log', to_regclass('public.crm_cron_log') is not null
-- union all
-- select 'threshold columns (4)',
--        (select count(*) = 4 from information_schema.columns
--          where table_name = 'crm_pharmacies'
--            and column_name in ('new_customer_days','inactive_days',
--                                'high_value_amount','repeat_min_visits'))
-- union all
-- select 'bill bucket is PRIVATE',
--        (select not public from storage.buckets where id = 'crm-bill-attachments')
-- union all
-- select 'storage policies are path-scoped',
--        (select count(*) = 0 from pg_policies
--          where schemaname = 'storage' and tablename = 'objects'
--            and policyname like 'crm_%'
--            and coalesce(qual,'') || coalesce(with_check,'') not like '%crm_storage_tenant%'
--            and cmd <> 'SELECT')
-- union all
-- select 'reminder override columns',
--        (select count(*) = 1 from information_schema.columns
--          where table_name = 'crm_scheduled_reminders' and column_name = 'medicine_id')
--    and (select count(*) = 1 from information_schema.columns
--          where table_name = 'crm_prescription_medicines' and column_name = 'reminder_override');
