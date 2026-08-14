-- ═══════════════════════════════════════════════════════════════════════
-- Cleanup: DELETE duplicate pending reminders
-- Run AFTER the PREVIEW script confirms the results look correct.
-- Keeps ONE reminder per (customer, scheduled_day), merges medicine names.
-- ═══════════════════════════════════════════════════════════════════════

-- Step 1: Update the KEEPER row to have all medicine names merged
WITH merged AS (
  SELECT
    customer_id,
    (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date AS sched_day,
    string_agg(DISTINCT variables->>'medicine', ', ' ORDER BY variables->>'medicine') AS merged_medicine,
    MIN(id) AS keep_id
  FROM crm_scheduled_reminders
  WHERE status = 'pending'
  GROUP BY customer_id, (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date
)
UPDATE crm_scheduled_reminders r
SET variables = jsonb_set(r.variables, '{medicine}', to_jsonb(m.merged_medicine))
FROM merged m
WHERE r.id = m.keep_id;

-- Step 2: DELETE all duplicate rows (everything that is NOT the keeper)
DELETE FROM crm_scheduled_reminders
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY customer_id, (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date
        ORDER BY scheduled_for ASC, id ASC
      ) AS rn
    FROM crm_scheduled_reminders
    WHERE status = 'pending'
  ) ranked
  WHERE rn > 1   -- delete all but the first (keeper)
);

-- Step 3: Confirm result
SELECT
  c.name AS customer,
  r.scheduled_for,
  r.variables->>'medicine' AS medicines,
  r.status
FROM crm_scheduled_reminders r
JOIN crm_customers c ON c.id = r.customer_id
WHERE r.status = 'pending'
ORDER BY r.scheduled_for;
