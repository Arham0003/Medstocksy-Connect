-- Migration: add DELETE RLS policy for crm_campaigns
--
-- The base migration (20260507_medcrm.sql) defined SELECT, INSERT, and UPDATE
-- policies but omitted DELETE.  With RLS enabled, a missing DELETE policy means
-- the delete silently returns success on the client but removes nothing from DB.
--
-- Policy: any authenticated member of the pharmacy may delete its campaigns.
-- (If you want admin-only delete, swap crm_is_member → crm_is_admin.)

DROP POLICY IF EXISTS campaigns_delete ON public.crm_campaigns;
CREATE POLICY campaigns_delete ON public.crm_campaigns
  FOR DELETE TO authenticated
  USING (public.crm_is_member(pharmacy_id));
