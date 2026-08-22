-- Fix: crm_can_send_now was missing the tenant guard that the other functions had.
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
BEGIN
  IF NOT public.crm_is_member(p_pharmacy_id) THEN
    RETURN false;
  END IF;

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
