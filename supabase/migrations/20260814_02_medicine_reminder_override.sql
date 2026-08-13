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

BEGIN;

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
