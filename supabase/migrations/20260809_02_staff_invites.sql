-- ═══════════════════════════════════════════════════════════════════════
-- Staff invites + member directory  (audit Phase 1 #3)
--
-- Context: crm_members.user_id references auth.users, so adding staff means
-- knowing a user id that does not exist until that person signs up. Creating
-- the account outright needs the service-role key via the Auth admin API,
-- which the browser must never hold.
--
-- So invites are claim-on-signup instead:
--   1. An admin records an invite (pharmacy + email + role).
--   2. The invitee signs up normally with that email.
--   3. On first load the app calls crm_claim_invites(), which turns any
--      pending invite matching their verified email into a crm_members row.
--
-- No secret token is needed: the match is on the email Supabase Auth has
-- already verified, so an invite cannot be claimed by anyone else.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crm_invites (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id  uuid NOT NULL REFERENCES public.crm_pharmacies(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         crm_member_role NOT NULL DEFAULT 'staff',
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Emails are matched case-insensitively, so store and index them folded.
-- Partial unique index: only ONE pending invite per email per pharmacy, but
-- re-inviting someone after they leave is still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_invites_pending
  ON public.crm_invites (pharmacy_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_invites_email
  ON public.crm_invites (lower(email))
  WHERE accepted_at IS NULL;

ALTER TABLE public.crm_invites ENABLE ROW LEVEL SECURITY;

-- Members can see their pharmacy's invites; only admins may create/revoke.
DROP POLICY IF EXISTS invites_select ON public.crm_invites;
CREATE POLICY invites_select ON public.crm_invites FOR SELECT TO authenticated
  USING (public.crm_is_member(pharmacy_id));

DROP POLICY IF EXISTS invites_admin_write ON public.crm_invites;
CREATE POLICY invites_admin_write ON public.crm_invites FOR ALL TO authenticated
  USING (public.crm_my_role(pharmacy_id) = 'admin')
  WITH CHECK (public.crm_my_role(pharmacy_id) = 'admin');


-- ── Member directory ────────────────────────────────────────────────────
-- crm_members stores only user_id; the email lives in auth.users, which is
-- not exposed to the anon/authenticated roles. This function joins the two
-- and returns ONLY the rows for a pharmacy the caller belongs to.
CREATE OR REPLACE FUNCTION public.crm_list_members(p_pharmacy_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_members jsonb;
  v_invites jsonb;
BEGIN
  IF NOT public.crm_is_member(p_pharmacy_id) THEN
    RAISE EXCEPTION 'not a member of pharmacy %', p_pharmacy_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(m ORDER BY m->>'joined_at'), '[]'::jsonb)
  INTO   v_members
  FROM (
    SELECT jsonb_build_object(
             'id',        mem.id,
             'user_id',   mem.user_id,
             'email',     u.email,
             'role',      mem.role,
             'joined_at', mem.joined_at,
             'is_owner',  (ph.owner_id = mem.user_id),
             'is_self',   (mem.user_id = auth.uid())
           ) AS m
    FROM      public.crm_members    mem
    JOIN      public.crm_pharmacies ph ON ph.id = mem.pharmacy_id
    LEFT JOIN auth.users            u  ON u.id  = mem.user_id
    WHERE     mem.pharmacy_id = p_pharmacy_id
  ) sub;

  SELECT COALESCE(jsonb_agg(i ORDER BY i->>'created_at' DESC), '[]'::jsonb)
  INTO   v_invites
  FROM (
    SELECT jsonb_build_object(
             'id',         inv.id,
             'email',      inv.email,
             'role',       inv.role,
             'created_at', inv.created_at
           ) AS i
    FROM   public.crm_invites inv
    WHERE  inv.pharmacy_id = p_pharmacy_id
      AND  inv.accepted_at IS NULL
  ) sub2;

  RETURN jsonb_build_object('members', v_members, 'invites', v_invites);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_list_members(uuid) TO authenticated;


-- ── Claim invites ───────────────────────────────────────────────────────
-- Called by the app after login. Converts every pending invite addressed to
-- the caller's own verified email into a membership. Returns how many were
-- claimed so the UI can refresh the pharmacy list when it is non-zero.
CREATE OR REPLACE FUNCTION public.crm_claim_invites()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email    text;
  v_uid      uuid := auth.uid();
  v_claimed  integer := 0;
  v_invite   record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  -- Read the email straight from auth.users rather than trusting a parameter,
  -- and only when it is confirmed — an unverified address must not be able to
  -- claim someone else's invite.
  SELECT lower(email) INTO v_email
  FROM   auth.users
  WHERE  id = v_uid
    AND  email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_invite IN
    SELECT * FROM public.crm_invites
    WHERE  accepted_at IS NULL
      AND  lower(email) = v_email
  LOOP
    -- ON CONFLICT: already a member of that pharmacy (e.g. invited twice, or
    -- invited after already joining). Still mark the invite consumed.
    INSERT INTO public.crm_members (pharmacy_id, user_id, role, invited_by)
    VALUES (v_invite.pharmacy_id, v_uid, v_invite.role, v_invite.invited_by)
    ON CONFLICT (pharmacy_id, user_id) DO NOTHING;

    UPDATE public.crm_invites
    SET    accepted_at = now(), accepted_by = v_uid
    WHERE  id = v_invite.id;

    v_claimed := v_claimed + 1;
  END LOOP;

  RETURN v_claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_claim_invites() TO authenticated;
