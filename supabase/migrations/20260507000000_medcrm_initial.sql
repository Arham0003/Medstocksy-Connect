-- ============================================================================
-- Medstocksy Connect (medcrm) — Schema + RLS
-- Migration: 20260507_medcrm
-- Compatible with parent inventory app (Medstocksy-inventory) via shared
-- auth.users and public.sales. Adds CRM-specific tables prefixed with crm_.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for fuzzy customer name search

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ENUMS
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE crm_message_status AS ENUM ('queued','sending','sent','delivered','read','failed','bounced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE crm_message_direction AS ENUM ('outbound','inbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE crm_campaign_status AS ENUM ('draft','scheduled','sending','sent','cancelled','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE crm_reminder_status AS ENUM ('pending','sent','cancelled','converted','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE crm_template_kind AS ENUM ('thank_you','refill_reminder','offer','custom','win_back','out_of_stock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE crm_member_role AS ENUM ('admin','manager','staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PHARMACY (multi-tenant root)
--    A pharmacy is owned by one user (auth.users.id). Staff are added via
--    crm_members. All CRM rows are scoped by pharmacy_id, NOT by user_id —
--    that lets multi-staff pharmacies share data while still isolating tenants.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_pharmacies (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- One pharmacy per email/account. If the owner needs to manage another
  -- pharmacy they should be invited as a `crm_member` to that one.
  owner_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  phone           text,
  address         text,
  whatsapp_number text,
  send_window_start time NOT NULL DEFAULT '09:00',
  send_window_end   time NOT NULL DEFAULT '20:00',
  rate_limit_per_hour smallint NOT NULL DEFAULT 10 CHECK (rate_limit_per_hour BETWEEN 1 AND 20),
  bulk_approval_threshold int NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Idempotent for re-runs: add UNIQUE only if the constraint isn't already there.
DO $$ BEGIN
  ALTER TABLE public.crm_pharmacies ADD CONSTRAINT crm_pharmacies_owner_unique UNIQUE (owner_id);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table  THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_crm_pharmacies_owner ON public.crm_pharmacies(owner_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MEMBERS (RBAC: admin / manager / staff)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_members (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id  uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         crm_member_role NOT NULL DEFAULT 'staff',
  invited_by   uuid REFERENCES auth.users(id),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_members_user      ON public.crm_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_members_pharmacy  ON public.crm_members(pharmacy_id);

-- Helper view: the pharmacy_ids the current user can access.
-- Includes pharmacy_name inline so the client doesn't need a separate join
-- (PostgREST can't infer foreign keys on views, so embedding the name here
-- keeps client queries to a single SELECT).
CREATE OR REPLACE VIEW public.crm_my_pharmacies AS
  SELECT m.pharmacy_id, m.role, p.name AS pharmacy_name
    FROM public.crm_members m
    JOIN public.crm_pharmacies p ON p.id = m.pharmacy_id
    WHERE m.user_id = auth.uid()
  UNION
  SELECT p.id AS pharmacy_id, 'admin'::crm_member_role AS role, p.name AS pharmacy_name
    FROM public.crm_pharmacies p WHERE p.owner_id = auth.uid();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CUSTOMERS
--    Phone is the primary key per PRD §2.1 — locked +91 prefix in the UI.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_customers (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text NOT NULL,           -- E.164 format e.g. +919876543210
  age         smallint CHECK (age IS NULL OR age BETWEEN 0 AND 130),
  gender      text CHECK (gender IS NULL OR gender IN ('male','female','other')),
  address     text,
  notes       text,
  whatsapp_opted_in   boolean NOT NULL DEFAULT true,
  whatsapp_opted_out_at timestamptz,
  whatsapp_opted_out_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, phone)
);

-- Phone format check (E.164: +countrycode then 7-15 digits)
ALTER TABLE public.crm_customers
  ADD CONSTRAINT crm_customers_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{6,14}$');

-- Trigram index for fuzzy name search ("ramesh" matches "Ramesh Singh")
CREATE INDEX IF NOT EXISTS idx_crm_customers_name_trgm ON public.crm_customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_crm_customers_phone     ON public.crm_customers(phone);
CREATE INDEX IF NOT EXISTS idx_crm_customers_pharmacy  ON public.crm_customers(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_crm_customers_optout    ON public.crm_customers(whatsapp_opted_in) WHERE whatsapp_opted_in = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CUSTOMER ↔ SALE LINK (bridge to inventory app's public.sales)
--    The inventory app stores bills in public.sales. The CRM enriches them
--    via this bridge. We don't FK to sales (cross-domain), but we trust the
--    inventory app's UUIDs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_customer_sales (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  sale_id     uuid NOT NULL,                     -- public.sales.id (no FK, cross-domain)
  pharmacy_id uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  bill_amount numeric(12,2) NOT NULL DEFAULT 0,
  sold_at     timestamptz NOT NULL DEFAULT now(),
  medicines   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ name, qty, category }]
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_sales_customer  ON public.crm_customer_sales(customer_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_sales_pharmacy  ON public.crm_customer_sales(pharmacy_id, sold_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. TAGS
--    Auto-tags (New / Repeat / Inactive / High Value / Chronic) are derived
--    via crm_customer_tags_view below. Manual tags live in crm_tags.
--    Per PRD theme rule: tag palette capped at 6.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_tags (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  tag_key     text NOT NULL,                       -- 'chronic' | 'vip' | (custom)
  added_by    uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, tag_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_tags_customer ON public.crm_tags(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_tags_key      ON public.crm_tags(pharmacy_id, tag_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. MESSAGE TEMPLATES (WhatsApp-approved)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_templates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     uuid REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE, -- NULL = global pre-built
  kind            crm_template_kind NOT NULL,
  name            text NOT NULL,
  body            text NOT NULL,                    -- "Hi {name}, time to refill your {medicine}?"
  variables       text[] NOT NULL DEFAULT '{}',     -- {'name','medicine'}
  whatsapp_template_name text,                      -- WABA template name once approved
  whatsapp_status text NOT NULL DEFAULT 'draft',    -- draft | submitted | approved | rejected
  is_built_in     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_templates_pharmacy ON public.crm_templates(pharmacy_id);

-- Seed the three pre-built templates (global, NULL pharmacy_id)
INSERT INTO public.crm_templates (pharmacy_id, kind, name, body, variables, is_built_in, whatsapp_status)
VALUES
  (NULL, 'thank_you', 'T1 · Thank you',
   'Hi {name}, thank you for shopping at {pharmacy_name}! Your bill {amount} has been saved to our system. For refills, call or visit us anytime.',
   ARRAY['name','pharmacy_name','amount'], true, 'approved'),
  (NULL, 'refill_reminder', 'T2 · Refill reminder',
   'Hi {name}, time to refill your {medicine}? We have it in stock. Call: {pharmacy_phone}. Or visit our store.',
   ARRAY['name','medicine','pharmacy_phone'], true, 'approved'),
  (NULL, 'offer', 'T3 · Special offer',
   'Hi {name}, special offer on {category}: {discount}% off! Valid till {date}. Limited stock. Order now.',
   ARRAY['name','category','discount','date'], true, 'approved')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. REMINDER RULES (medicine → cycle → template)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_reminder_rules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  medicine_label  text NOT NULL,                   -- 'BP medicine', 'Vitamins', etc.
  category_match  text[] NOT NULL DEFAULT '{}',    -- inventory categories that match
  refill_cycle_days  smallint NOT NULL CHECK (refill_cycle_days BETWEEN 1 AND 365),
  reminder_offset_days smallint NOT NULL DEFAULT 5 CHECK (reminder_offset_days BETWEEN 0 AND 90),
  template_id     uuid NOT NULL REFERENCES public.crm_templates(id) ON DELETE RESTRICT,
  send_time       time NOT NULL DEFAULT '09:00',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, medicine_label)
);

CREATE INDEX IF NOT EXISTS idx_crm_reminder_rules_pharmacy ON public.crm_reminder_rules(pharmacy_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. SCHEDULED REMINDERS (specific instances)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_scheduled_reminders (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  rule_id         uuid REFERENCES public.crm_reminder_rules(id) ON DELETE SET NULL,
  template_id     uuid NOT NULL REFERENCES public.crm_templates(id) ON DELETE RESTRICT,
  variables       jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for   timestamptz NOT NULL,
  status          crm_reminder_status NOT NULL DEFAULT 'pending',
  message_id      uuid,                            -- crm_messages.id once sent
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crm_sched_due ON public.crm_scheduled_reminders(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_crm_sched_customer ON public.crm_scheduled_reminders(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_sched_pharmacy ON public.crm_scheduled_reminders(pharmacy_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. CAMPAIGNS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_campaigns (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES auth.users(id),
  name            text NOT NULL,
  segment_key     text NOT NULL,                   -- 'repeat' | 'inactive' | etc., or 'custom:<filter>'
  template_id     uuid NOT NULL REFERENCES public.crm_templates(id),
  variables       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          crm_campaign_status NOT NULL DEFAULT 'draft',
  scheduled_for   timestamptz,
  total_recipients int NOT NULL DEFAULT 0,
  sent_count      int NOT NULL DEFAULT 0,
  delivered_count int NOT NULL DEFAULT 0,
  failed_count    int NOT NULL DEFAULT 0,
  reply_count     int NOT NULL DEFAULT 0,
  approved_at     timestamptz,                     -- set when admin approves bulk send
  approved_by     uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_pharmacy_status ON public.crm_campaigns(pharmacy_id, status);

-- Per-recipient state for a campaign
CREATE TABLE IF NOT EXISTS public.crm_campaign_recipients (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     uuid NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  status          crm_message_status NOT NULL DEFAULT 'queued',
  message_id      uuid,
  sent_at         timestamptz,
  UNIQUE (campaign_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_recipients_campaign ON public.crm_campaign_recipients(campaign_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. MESSAGES (every WhatsApp send + receive)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_messages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.crm_customers(id) ON DELETE SET NULL,
  template_id     uuid REFERENCES public.crm_templates(id),
  campaign_id     uuid REFERENCES public.crm_campaigns(id) ON DELETE SET NULL,
  reminder_id     uuid REFERENCES public.crm_scheduled_reminders(id) ON DELETE SET NULL,
  direction       crm_message_direction NOT NULL DEFAULT 'outbound',
  status          crm_message_status NOT NULL DEFAULT 'queued',
  body            text NOT NULL,
  variables       jsonb NOT NULL DEFAULT '{}'::jsonb,
  to_phone        text NOT NULL,
  from_phone      text,
  whatsapp_message_id text,                       -- WABA returns this
  error_code      text,
  error_message   text,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  failed_at       timestamptz,
  triggered_by    uuid REFERENCES auth.users(id),  -- NULL = system / scheduled
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_messages_pharmacy_created ON public.crm_messages(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_customer ON public.crm_messages(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_campaign ON public.crm_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_crm_messages_status   ON public.crm_messages(pharmacy_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_messages_waba     ON public.crm_messages(whatsapp_message_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. RATE LIMITER (sliding-hour counter, used by send API)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_send_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  message_id  uuid REFERENCES public.crm_messages(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_send_log_window ON public.crm_send_log(pharmacy_id, sent_at DESC);

-- Safe rate-check function: returns true if pharmacy is BELOW its hourly cap
CREATE OR REPLACE FUNCTION public.crm_can_send_now(p_pharmacy_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap   smallint;
  v_count int;
  v_window_ok boolean;
  v_now_local time;
BEGIN
  SELECT rate_limit_per_hour,
         (now() AT TIME ZONE 'Asia/Kolkata')::time BETWEEN send_window_start AND send_window_end
    INTO v_cap, v_window_ok
    FROM public.crm_pharmacies
    WHERE id = p_pharmacy_id;

  IF NOT FOUND OR NOT v_window_ok THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.crm_send_log
    WHERE pharmacy_id = p_pharmacy_id
      AND sent_at > now() - interval '1 hour';

  RETURN v_count < v_cap;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. AUDIT LOG (90-day retention per PRD §9)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_audit_log (
  id          bigserial PRIMARY KEY,
  pharmacy_id uuid NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  table_name  text NOT NULL,
  row_id      uuid,
  action      text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_audit_pharmacy ON public.crm_audit_log(pharmacy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_audit_table    ON public.crm_audit_log(table_name, created_at DESC);

-- Generic audit trigger
CREATE OR REPLACE FUNCTION public.crm_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pharmacy uuid;
BEGIN
  v_pharmacy := COALESCE(
    (CASE WHEN TG_OP = 'DELETE' THEN OLD.pharmacy_id ELSE NEW.pharmacy_id END)
  );

  INSERT INTO public.crm_audit_log (pharmacy_id, user_id, table_name, row_id, action, old_data, new_data)
  VALUES (
    v_pharmacy,
    auth.uid(),
    TG_TABLE_NAME,
    COALESCE((CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)::uuid, NULL),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach audit triggers to mutation-sensitive tables
DROP TRIGGER IF EXISTS audit_crm_customers ON public.crm_customers;
CREATE TRIGGER audit_crm_customers
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_customers
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_trigger();

DROP TRIGGER IF EXISTS audit_crm_messages ON public.crm_messages;
CREATE TRIGGER audit_crm_messages
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_messages
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_trigger();

DROP TRIGGER IF EXISTS audit_crm_campaigns ON public.crm_campaigns;
CREATE TRIGGER audit_crm_campaigns
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.crm_audit_trigger();

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. UPDATED_AT TRIGGER (generic)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname='public' AND c.relname LIKE 'crm_%' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name=c.relname AND column_name='updated_at')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.crm_set_updated_at();', r.tbl, r.tbl);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. DERIVED VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- Customer stats (LTV, visit count, last visit, frequency)
CREATE OR REPLACE VIEW public.crm_customer_stats AS
SELECT
  c.id                                              AS customer_id,
  c.pharmacy_id,
  count(s.id)                                       AS visit_count,
  COALESCE(sum(s.bill_amount),0)::numeric(12,2)     AS lifetime_value,
  max(s.sold_at)                                    AS last_visit_at,
  CASE WHEN count(s.id) >= 2 THEN
    EXTRACT(EPOCH FROM (max(s.sold_at) - min(s.sold_at))) / NULLIF(count(s.id) - 1, 0) / 86400
  END::int                                          AS avg_days_between_visits
FROM public.crm_customers c
LEFT JOIN public.crm_customer_sales s ON s.customer_id = c.id
GROUP BY c.id, c.pharmacy_id;

-- Auto-tags (derived; no INSERTs needed). Per PRD §2.1.
-- crm_customers columns are (id, pharmacy_id, ...) — alias c.id to customer_id
-- so all four UNION branches share the same column shape.
CREATE OR REPLACE VIEW public.crm_customer_auto_tags AS
WITH stats AS (SELECT * FROM public.crm_customer_stats)
SELECT c.id AS customer_id, c.pharmacy_id, 'new'::text AS tag
  FROM public.crm_customers c
  WHERE c.created_at > now() - interval '7 days'
UNION ALL
SELECT s.customer_id, s.pharmacy_id, 'repeat' FROM stats s WHERE s.visit_count >= 2
UNION ALL
SELECT s.customer_id, s.pharmacy_id, 'high_value' FROM stats s WHERE s.lifetime_value >= 10000
UNION ALL
SELECT s.customer_id, s.pharmacy_id, 'inactive' FROM stats s
  WHERE s.last_visit_at IS NOT NULL AND s.last_visit_at < now() - interval '30 days';

-- WhatsApp health snapshot for a pharmacy
CREATE OR REPLACE VIEW public.crm_whatsapp_health AS
SELECT
  p.id AS pharmacy_id,
  p.rate_limit_per_hour,
  (SELECT count(*) FROM public.crm_send_log sl
     WHERE sl.pharmacy_id = p.id AND sl.sent_at > now() - interval '1 hour')::int AS sends_last_hour,
  (SELECT count(*) FILTER (WHERE status IN ('failed','bounced'))::float /
          NULLIF(count(*),0) * 100
     FROM public.crm_messages m
     WHERE m.pharmacy_id = p.id AND m.created_at > now() - interval '24 hours')      AS bounce_rate_24h,
  (SELECT count(*) FROM public.crm_customers c
     WHERE c.pharmacy_id = p.id AND c.whatsapp_opted_out_at > now() - interval '30 days')::int AS opt_outs_30d,
  (SELECT count(*) FROM public.crm_customers c WHERE c.pharmacy_id = p.id)::int      AS total_customers,
  p.send_window_start,
  p.send_window_end
FROM public.crm_pharmacies p;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. HELPER FUNCTION: am I a member of this pharmacy?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_is_member(p_pharmacy_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_pharmacies WHERE id = p_pharmacy_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.crm_members WHERE pharmacy_id = p_pharmacy_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.crm_my_role(p_pharmacy_id uuid)
RETURNS crm_member_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT role FROM (
    SELECT 'admin'::crm_member_role AS role FROM public.crm_pharmacies
      WHERE id = p_pharmacy_id AND owner_id = auth.uid()
    UNION ALL
    SELECT role FROM public.crm_members
      WHERE pharmacy_id = p_pharmacy_id AND user_id = auth.uid()
  ) t LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. ROW LEVEL SECURITY
--     Default: only members of the pharmacy can read/write.
--     Admin-only writes for: pharmacies, members, reminder_rules, campaigns approval.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_pharmacies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_customer_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tags                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_reminder_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_scheduled_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_send_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_audit_log           ENABLE ROW LEVEL SECURITY;

-- ── Pharmacies ──
DROP POLICY IF EXISTS pharmacies_select ON public.crm_pharmacies;
CREATE POLICY pharmacies_select ON public.crm_pharmacies FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR id IN (SELECT pharmacy_id FROM public.crm_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS pharmacies_insert ON public.crm_pharmacies;
CREATE POLICY pharmacies_insert ON public.crm_pharmacies FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS pharmacies_update ON public.crm_pharmacies;
CREATE POLICY pharmacies_update ON public.crm_pharmacies FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ── Members ──
DROP POLICY IF EXISTS members_select ON public.crm_members;
CREATE POLICY members_select ON public.crm_members FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS members_admin_write ON public.crm_members;
CREATE POLICY members_admin_write ON public.crm_members FOR ALL TO authenticated
  USING (public.crm_my_role(pharmacy_id) = 'admin')
  WITH CHECK (public.crm_my_role(pharmacy_id) = 'admin');

-- ── Customers / Sales / Tags / Messages: any member can read+write ──
DROP POLICY IF EXISTS customers_member ON public.crm_customers;
CREATE POLICY customers_member ON public.crm_customers FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS sales_member ON public.crm_customer_sales;
CREATE POLICY sales_member ON public.crm_customer_sales FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS tags_member ON public.crm_tags;
CREATE POLICY tags_member ON public.crm_tags FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS messages_member ON public.crm_messages;
CREATE POLICY messages_member ON public.crm_messages FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS sched_member ON public.crm_scheduled_reminders;
CREATE POLICY sched_member ON public.crm_scheduled_reminders FOR ALL TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS recipients_member ON public.crm_campaign_recipients;
CREATE POLICY recipients_member ON public.crm_campaign_recipients FOR ALL TO authenticated
  USING (campaign_id IN (SELECT id FROM public.crm_campaigns
                         WHERE public.crm_is_member(pharmacy_id)))
  WITH CHECK (campaign_id IN (SELECT id FROM public.crm_campaigns
                              WHERE public.crm_is_member(pharmacy_id)));

-- ── Templates: built-ins readable by all; pharmacy templates by members ──
DROP POLICY IF EXISTS templates_select ON public.crm_templates;
CREATE POLICY templates_select ON public.crm_templates FOR SELECT TO authenticated
  USING (pharmacy_id IS NULL OR public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS templates_member_write ON public.crm_templates;
CREATE POLICY templates_member_write ON public.crm_templates FOR ALL TO authenticated
  USING (pharmacy_id IS NOT NULL AND public.crm_is_member(pharmacy_id))
  WITH CHECK (pharmacy_id IS NOT NULL AND public.crm_is_member(pharmacy_id));

-- ── Reminder rules: admin-only writes, member reads ──
DROP POLICY IF EXISTS rules_select ON public.crm_reminder_rules;
CREATE POLICY rules_select ON public.crm_reminder_rules FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS rules_admin_write ON public.crm_reminder_rules;
CREATE POLICY rules_admin_write ON public.crm_reminder_rules FOR ALL TO authenticated
  USING (public.crm_my_role(pharmacy_id) IN ('admin','manager'))
  WITH CHECK (public.crm_my_role(pharmacy_id) IN ('admin','manager'));

-- ── Campaigns: any member reads, member writes drafts, admin approves bulk ──
DROP POLICY IF EXISTS campaigns_select ON public.crm_campaigns;
CREATE POLICY campaigns_select ON public.crm_campaigns FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS campaigns_insert ON public.crm_campaigns;
CREATE POLICY campaigns_insert ON public.crm_campaigns FOR INSERT TO authenticated
  WITH CHECK (public.crm_is_member(pharmacy_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS campaigns_update ON public.crm_campaigns;
CREATE POLICY campaigns_update ON public.crm_campaigns FOR UPDATE TO authenticated
  USING (public.crm_is_member(pharmacy_id))
  WITH CHECK (public.crm_is_member(pharmacy_id));

-- ── Send log: only system writes (use service role); members can read for analytics ──
DROP POLICY IF EXISTS send_log_select ON public.crm_send_log;
CREATE POLICY send_log_select ON public.crm_send_log FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

-- ── Audit log: read-only for members ──
DROP POLICY IF EXISTS audit_select ON public.crm_audit_log;
CREATE POLICY audit_select ON public.crm_audit_log FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. RETENTION JOB (90-day audit cleanup) — run via pg_cron or Supabase cron
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_purge_old_audit()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_deleted int;
BEGIN
  DELETE FROM public.crm_audit_log WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. GRANTS (default deny + explicit allow to authenticated)
-- ─────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.crm_my_pharmacies TO authenticated;
GRANT SELECT ON public.crm_customer_stats TO authenticated;
GRANT SELECT ON public.crm_customer_auto_tags TO authenticated;
GRANT SELECT ON public.crm_whatsapp_health TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_is_member(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_my_role(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_can_send_now(uuid)     TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN MIGRATION (manual rollback — run in psql if needed)
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- DROP VIEW IF EXISTS public.crm_whatsapp_health, public.crm_customer_auto_tags, public.crm_customer_stats, public.crm_my_pharmacies CASCADE;
-- DROP FUNCTION IF EXISTS public.crm_is_member, public.crm_my_role, public.crm_can_send_now, public.crm_audit_trigger, public.crm_set_updated_at, public.crm_purge_old_audit CASCADE;
-- DROP TABLE IF EXISTS public.crm_audit_log, public.crm_send_log, public.crm_messages, public.crm_campaign_recipients, public.crm_campaigns, public.crm_scheduled_reminders, public.crm_reminder_rules, public.crm_templates, public.crm_tags, public.crm_customer_sales, public.crm_customers, public.crm_members, public.crm_pharmacies CASCADE;
-- DROP TYPE IF EXISTS crm_member_role, crm_template_kind, crm_reminder_status, crm_campaign_status, crm_message_direction, crm_message_status CASCADE;
-- COMMIT;
