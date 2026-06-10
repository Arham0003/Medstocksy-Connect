-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Refill scheduling DB trigger
-- Moves the "schedule next reminder after refill" logic from client TS
-- into a AFTER INSERT trigger — zero extra client round-trips.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION crm_after_refill_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_med_name     text;
  v_interval     integer;
  v_tpl_id       uuid;
  v_when         timestamptz;
BEGIN
  -- Fetch medicine details (single row, indexed on PK)
  SELECT medicine_name, COALESCE(refill_interval_days, 0)
  INTO   v_med_name, v_interval
  FROM   crm_prescription_medicines
  WHERE  id = NEW.medicine_id;

  -- Nothing to schedule if no interval set
  IF v_interval <= 0 THEN
    RETURN NEW;
  END IF;

  -- Find best refill_reminder template for this pharmacy
  SELECT id INTO v_tpl_id
  FROM   crm_templates
  WHERE  kind = 'refill_reminder'
    AND  (pharmacy_id IS NULL OR pharmacy_id = NEW.pharmacy_id)
  ORDER BY is_built_in DESC
  LIMIT  1;

  IF v_tpl_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Schedule (interval - 5) days from now at 09:00 IST, min 1 day
  v_when := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata' +
            (GREATEST(v_interval - 5, 1) || ' days')::interval)
            + interval '9 hours';
  -- Convert back to UTC for storage
  v_when := v_when AT TIME ZONE 'Asia/Kolkata';

  INSERT INTO crm_scheduled_reminders
    (pharmacy_id, customer_id, template_id, scheduled_for, variables)
  VALUES
    (NEW.pharmacy_id, NEW.customer_id, v_tpl_id, v_when,
     jsonb_build_object('medicine', v_med_name));

  RETURN NEW;
EXCEPTION
  -- Never fail the refill insert because of a reminder scheduling error
  WHEN OTHERS THEN
    RAISE WARNING '[crm_after_refill_insert] reminder scheduling failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Drop old trigger if it exists, then recreate
DROP TRIGGER IF EXISTS trg_crm_refill_schedule ON crm_prescription_refills;

CREATE TRIGGER trg_crm_refill_schedule
  AFTER INSERT ON crm_prescription_refills
  FOR EACH ROW
  EXECUTE FUNCTION crm_after_refill_insert();
