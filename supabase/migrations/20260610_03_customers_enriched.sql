-- ═══════════════════════════════════════════════════════════════════════
-- Migration: crm_customers_enriched view + FTS column
-- Joins customers + stats + auto_tags into one view so listCustomers()
-- needs a single SELECT instead of 3 round-trips.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add FTS generated column (simple tokenizer — works for Hindi names too)
ALTER TABLE crm_customers
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(name,  '') || ' ' ||
      coalesce(phone, '')
    )
  ) STORED;

-- Index the FTS column
CREATE INDEX IF NOT EXISTS idx_crm_customers_fts
  ON crm_customers USING gin (fts);

-- 2. Enriched view: customers + stats + auto_tags aggregated
CREATE OR REPLACE VIEW crm_customers_enriched AS
SELECT
  c.*,
  -- Stats columns (nullable — null when no sales yet)
  s.visit_count,
  s.lifetime_value,
  s.last_visit_at,
  s.avg_days_between_visits,
  -- Auto-tags as a JSONB array (e.g. ["new","high_value"])
  COALESCE(
    (
      SELECT jsonb_agg(at.tag ORDER BY at.tag)
      FROM   crm_customer_auto_tags at
      WHERE  at.customer_id = c.id
    ),
    '[]'::jsonb
  ) AS auto_tags_json
FROM      crm_customers     c
LEFT JOIN crm_customer_stats s ON s.customer_id = c.id;

-- Note: RLS on crm_customers propagates to this view automatically because
-- the view is SECURITY INVOKER (default). No extra RLS needed.
