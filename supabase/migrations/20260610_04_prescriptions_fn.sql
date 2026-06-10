-- ═══════════════════════════════════════════════════════════════════════
-- Migration: crm_get_prescriptions_for_customer RPC
-- Replaces 3-level sequential waterfall (prescriptions → medicines → refills)
-- with a single DB-side LATERAL join returning nested JSON.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION crm_get_prescriptions_for_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
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
    ORDER BY p.prescription_date DESC
    LIMIT 50
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION crm_get_prescriptions_for_customer(uuid) TO authenticated;
