-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Fix crm_dashboard_counts to include overdue pending reminders
-- today_pending: ALL pending reminders (not just today's date window)
-- upcoming_7d:   ALL pending reminders (= total pending queue)
-- reminders_due_today: ALL pending (overdue + today) so Pulse stat = bell count
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION crm_dashboard_counts(p_pharmacy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
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
  RETURN jsonb_build_object(
    -- KPI tile 1: Total customers + new this week
    'total_customers',    (SELECT count(*) FROM crm_customers       WHERE pharmacy_id = p_pharmacy_id),
    'this_week',          (SELECT count(*) FROM crm_customers       WHERE pharmacy_id = p_pharmacy_id AND created_at >= v_7d_ago),

    -- KPI tile 2: Pending reminders (ALL pending, including overdue)
    -- "today_pending" = all un-sent pending reminders (overdue + today + future)
    'today_pending',      (SELECT count(*) FROM crm_scheduled_reminders WHERE pharmacy_id = p_pharmacy_id AND status = 'pending'),
    -- "today_sent" = sent today (sent_at in today's window)
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
    -- Due stat = ALL pending (overdue + today) so it matches the bell badge
    'reminders_due_today',(SELECT count(*) FROM crm_scheduled_reminders    WHERE pharmacy_id = p_pharmacy_id AND status = 'pending'
                              AND scheduled_for < v_today_end)
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION crm_dashboard_counts(uuid) TO authenticated;
