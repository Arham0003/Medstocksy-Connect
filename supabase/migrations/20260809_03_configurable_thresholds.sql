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
