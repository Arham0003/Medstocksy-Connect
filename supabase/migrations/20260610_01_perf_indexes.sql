-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Performance Indexes
-- Adds composite + trigram indexes for all high-frequency query patterns.
-- All CREATE INDEX statements use IF NOT EXISTS — safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════

-- ── pg_trgm extension (needed for ILIKE → index rewrite) ──────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── crm_customers ─────────────────────────────────────────────────────
-- Pharmacy list sorted by newest first (default sort)
CREATE INDEX IF NOT EXISTS idx_crm_customers_pharmacy_created
  ON crm_customers (pharmacy_id, created_at DESC);

-- Name sort
CREATE INDEX IF NOT EXISTS idx_crm_customers_pharmacy_name
  ON crm_customers (pharmacy_id, name);

-- Trigram index for ILIKE name search (supports %term% pattern)
CREATE INDEX IF NOT EXISTS idx_crm_customers_name_trgm
  ON crm_customers USING gin (name gin_trgm_ops);

-- Trigram index for ILIKE phone search
CREATE INDEX IF NOT EXISTS idx_crm_customers_phone_trgm
  ON crm_customers USING gin (phone gin_trgm_ops);

-- Family member lookup
CREATE INDEX IF NOT EXISTS idx_crm_customers_family_of
  ON crm_customers (family_of_id)
  WHERE family_of_id IS NOT NULL;

-- WhatsApp opt-out segment filter
CREATE INDEX IF NOT EXISTS idx_crm_customers_pharmacy_optin
  ON crm_customers (pharmacy_id, whatsapp_opted_in);

-- ── crm_scheduled_reminders ───────────────────────────────────────────
-- Most queried table: dashboard counts + bell + reminders page
-- Covers: pharmacy_id + status + scheduled_for (all 3 always used together)
CREATE INDEX IF NOT EXISTS idx_crm_reminders_pharmacy_status_for
  ON crm_scheduled_reminders (pharmacy_id, status, scheduled_for);

-- Sent-at filter (dashboard today_sent count)
CREATE INDEX IF NOT EXISTS idx_crm_reminders_pharmacy_status_sent
  ON crm_scheduled_reminders (pharmacy_id, status, sent_at)
  WHERE status = 'sent';

-- ── crm_customer_sales ────────────────────────────────────────────────
-- Revenue queries: today / yesterday / month window aggregations
CREATE INDEX IF NOT EXISTS idx_crm_sales_pharmacy_sold_at
  ON crm_customer_sales (pharmacy_id, sold_at DESC);

-- Customer sales lookup (customer profile stats)
CREATE INDEX IF NOT EXISTS idx_crm_sales_customer_sold
  ON crm_customer_sales (customer_id, sold_at DESC);

-- ── crm_prescription_refills ─────────────────────────────────────────
-- Revenue aggregations + refill stats per medicine
CREATE INDEX IF NOT EXISTS idx_crm_refills_pharmacy_refilled
  ON crm_prescription_refills (pharmacy_id, refilled_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_refills_medicine_refilled
  ON crm_prescription_refills (medicine_id, refilled_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_refills_customer
  ON crm_prescription_refills (customer_id, refilled_at DESC);

-- ── crm_prescription_medicines ────────────────────────────────────────
-- Fetched by prescription_id ordered by position
CREATE INDEX IF NOT EXISTS idx_crm_rx_meds_prescription_pos
  ON crm_prescription_medicines (prescription_id, position);

-- ── crm_prescriptions ─────────────────────────────────────────────────
-- Customer profile: list by customer_id, date desc
CREATE INDEX IF NOT EXISTS idx_crm_prescriptions_customer_date
  ON crm_prescriptions (customer_id, prescription_date DESC);

-- Dashboard recent prescriptions widget
CREATE INDEX IF NOT EXISTS idx_crm_prescriptions_pharmacy_created
  ON crm_prescriptions (pharmacy_id, created_at DESC);

-- ── crm_messages ─────────────────────────────────────────────────────
-- Dashboard outbound count + activity timeline
CREATE INDEX IF NOT EXISTS idx_crm_messages_pharmacy_created
  ON crm_messages (pharmacy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_messages_customer_created
  ON crm_messages (customer_id, created_at DESC);

-- ── crm_tags ─────────────────────────────────────────────────────────
-- Chronic count + manual tag lookup
CREATE INDEX IF NOT EXISTS idx_crm_tags_pharmacy_key
  ON crm_tags (pharmacy_id, tag_key);

CREATE INDEX IF NOT EXISTS idx_crm_tags_customer_key
  ON crm_tags (customer_id, tag_key);

-- ── crm_customer_auto_tags + crm_customer_stats ─────────────────────
-- These are VIEWS (not tables) — cannot index views directly.
-- Their underlying tables already have PK indexes on customer_id.
-- No action needed here.

-- ── crm_templates ────────────────────────────────────────────────────
-- Reminder scheduler: kind filter + pharmacy scope
CREATE INDEX IF NOT EXISTS idx_crm_templates_kind_pharmacy
  ON crm_templates (kind, pharmacy_id, is_built_in DESC);
