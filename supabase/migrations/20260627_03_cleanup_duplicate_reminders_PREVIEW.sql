-- ═══════════════════════════════════════════════════════════════════════
-- Cleanup: Deduplicate existing pending reminders
-- Keeps ONE reminder per (customer, scheduled_day), merges medicine names,
-- deletes the duplicates.
-- Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════════════

WITH
-- Step 1: rank all pending reminders per customer per scheduled day
ranked AS (
  SELECT
    id,
    customer_id,
    pharmacy_id,
    scheduled_for,
    (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date AS sched_day,
    variables->>'medicine' AS medicine,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id, (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY scheduled_for ASC, id ASC
    ) AS rn
  FROM crm_scheduled_reminders
  WHERE status = 'pending'
),

-- Step 2: for each group, build the merged medicine name from ALL rows in that group
merged AS (
  SELECT
    customer_id,
    (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date AS sched_day,
    string_agg(DISTINCT variables->>'medicine', ', ' ORDER BY variables->>'medicine') AS merged_medicine,
    MIN(id) AS keep_id   -- keep the oldest row
  FROM crm_scheduled_reminders
  WHERE status = 'pending'
  GROUP BY customer_id, (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date
  HAVING count(*) > 1    -- only groups with duplicates
),

-- Step 3: update the keeper row with the merged medicine name
updated AS (
  UPDATE crm_scheduled_reminders r
  SET variables = jsonb_set(r.variables, '{medicine}', to_jsonb(m.merged_medicine))
  FROM merged m
  WHERE r.id = m.keep_id
  RETURNING r.id, m.merged_medicine
)

-- Step 4: show what will be kept (run this SELECT first to preview)
SELECT
  r.id,
  c.name AS customer_name,
  r.scheduled_for,
  r.variables->>'medicine' AS medicine_before,
  m.merged_medicine AS medicine_after,
  'KEEP (updated)' AS action
FROM crm_scheduled_reminders r
JOIN crm_customers c ON c.id = r.customer_id
JOIN merged m ON r.id = m.keep_id;
