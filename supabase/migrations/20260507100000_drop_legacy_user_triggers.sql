-- ============================================================================
-- PATCH: Strip ALL non-internal triggers from auth.users
-- ============================================================================
-- Symptom:  "Database error saving new user" on signup.
-- Cause:    Old apps (Medstocksy-inventory + medcrm-app) installed triggers on
--           auth.users that try to insert into accounts/profiles/settings.
--           Schema drift between the apps means one of those inserts fails
--           with a NOT NULL / FK / column-missing error → entire signUp
--           transaction rolls back.
-- Fix:      Drop every NON-internal trigger on auth.users and the legacy
--           handle_new_user() function. medcrm-v2 doesn't need any of them —
--           Onboarding creates the pharmacy explicitly after signup.
--
-- Run in: https://supabase.com/dashboard/project/ypeopwzkemqlgvvgyhcw/sql/new
-- ============================================================================

BEGIN;

-- ── 0. Pre-flight: list everything currently on auth.users ───────────────────
DO $$
DECLARE
  v text;
BEGIN
  SELECT string_agg(format('  %s -> %s.%s()', tgname, n2.nspname, p.proname), E'\n')
    INTO v
    FROM pg_trigger t
    JOIN pg_class c   ON t.tgrelid = c.oid
    JOIN pg_namespace n  ON c.relnamespace = n.oid
    JOIN pg_proc p    ON t.tgfoid = p.oid
    JOIN pg_namespace n2 ON p.pronamespace = n2.oid
    WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
  IF v IS NOT NULL THEN
    RAISE NOTICE E'BEFORE — non-internal triggers on auth.users:\n%', v;
  ELSE
    RAISE NOTICE 'BEFORE — auth.users is already clean (no custom triggers).';
  END IF;
END $$;

-- ── 1. Drop every non-internal trigger on auth.users dynamically ─────────────
-- Belt-and-braces: even if a trigger has a different name than the one I know
-- about, this loop catches it.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'auth'
        AND c.relname = 'users'
        AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON auth.users', r.tgname);
    RAISE NOTICE 'Dropped trigger %', r.tgname;
  END LOOP;
END $$;

-- ── 2. Drop the legacy handle_new_user function (unused after step 1) ────────
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- ── 3. Post-flight: confirm clean ────────────────────────────────────────────
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
  IF v_count = 0 THEN
    RAISE NOTICE 'AFTER — auth.users has 0 non-internal triggers. Signup will succeed.';
  ELSE
    RAISE WARNING 'AFTER — % trigger(s) still attached. Drop manually.', v_count;
  END IF;
END $$;

COMMIT;

-- ── Verify by signing up again. If it still fails, paste the full Supabase
--    error response (Network tab → /auth/v1/signup → Response). The error
--    will be specific now (not the generic "Database error saving new user").
