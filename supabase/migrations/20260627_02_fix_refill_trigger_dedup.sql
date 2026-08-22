-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Fix refill trigger to create ONE reminder per prescription
-- instead of one per medicine item.
--
-- Change: Before inserting a new reminder, check if the same customer
-- already has a pending reminder on the same scheduled date (within the
-- same day window). If yes, just update its medicine variable to append
-- the new medicine name — no duplicate row created.
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
  v_when_day     date;
  v_existing_id  uuid;
  v_existing_med text;
BEGIN
  -- Fetch medicine details
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

  -- Calculate target date: (interval - 5) days from now at 09:00 IST
  v_when := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata' +
            (GREATEST(v_interval - 5, 1) || ' days')::interval)
            + interval '9 hours';
  -- Convert back to UTC for storage
  v_when := v_when AT TIME ZONE 'Asia/Kolkata';
  v_when_day := (v_when AT TIME ZONE 'Asia/Kolkata')::date;

  -- Check: does this customer already have a pending reminder on that day?
  SELECT id, (variables->>'medicine')
  INTO   v_existing_id, v_existing_med
  FROM   crm_scheduled_reminders
  WHERE  pharmacy_id = NEW.pharmacy_id
    AND  customer_id = NEW.customer_id
    AND  status      = 'pending'
    AND  (scheduled_for AT TIME ZONE 'Asia/Kolkata')::date = v_when_day
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Append this medicine name to the existing reminder's medicine variable
    -- so the message says "Dolo, Insulin" instead of just "Dolo"
    UPDATE crm_scheduled_reminders
    SET    variables = jsonb_set(
                         variables,
                         '{medicine}',
                         to_jsonb(v_existing_med || ', ' || v_med_name)
                       )
    WHERE  id = v_existing_id;
  ELSE
    -- No existing reminder that day — create a fresh one
    INSERT INTO crm_scheduled_reminders
      (pharmacy_id, customer_id, template_id, scheduled_for, variables)
    VALUES
      (NEW.pharmacy_id, NEW.customer_id, v_tpl_id, v_when,
       jsonb_build_object('medicine', v_med_name));
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[crm_after_refill_insert] reminder scheduling failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Recreate trigger (function already replaced above)
DROP TRIGGER IF EXISTS trg_crm_refill_schedule ON crm_prescription_refills;

CREATE TRIGGER trg_crm_refill_schedule
  AFTER INSERT ON crm_prescription_refills
  FOR EACH ROW
  EXECUTE FUNCTION crm_after_refill_insert();
