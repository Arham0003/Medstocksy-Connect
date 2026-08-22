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
