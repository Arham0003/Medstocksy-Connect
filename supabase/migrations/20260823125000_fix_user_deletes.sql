-- ponytail: root cause for "Database error deleting user"
-- Missing cascading rules on CRM tables pointing to auth.users.

-- 1. crm_pharmacies.owner_id
ALTER TABLE public.crm_pharmacies DROP CONSTRAINT IF EXISTS crm_pharmacies_owner_id_fkey;
ALTER TABLE public.crm_pharmacies ADD CONSTRAINT crm_pharmacies_owner_id_fkey 
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. crm_members.invited_by
ALTER TABLE public.crm_members DROP CONSTRAINT IF EXISTS crm_members_invited_by_fkey;
ALTER TABLE public.crm_members ADD CONSTRAINT crm_members_invited_by_fkey 
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. crm_tags.added_by
ALTER TABLE public.crm_tags DROP CONSTRAINT IF EXISTS crm_tags_added_by_fkey;
ALTER TABLE public.crm_tags ADD CONSTRAINT crm_tags_added_by_fkey 
  FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. crm_campaigns.created_by (was NOT NULL, drop that first to allow SET NULL)
ALTER TABLE public.crm_campaigns ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_created_by_fkey;
ALTER TABLE public.crm_campaigns ADD CONSTRAINT crm_campaigns_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 5. crm_campaigns.approved_by
ALTER TABLE public.crm_campaigns DROP CONSTRAINT IF EXISTS crm_campaigns_approved_by_fkey;
ALTER TABLE public.crm_campaigns ADD CONSTRAINT crm_campaigns_approved_by_fkey 
  FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 6. crm_messages.triggered_by
ALTER TABLE public.crm_messages DROP CONSTRAINT IF EXISTS crm_messages_triggered_by_fkey;
ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_triggered_by_fkey 
  FOREIGN KEY (triggered_by) REFERENCES auth.users(id) ON DELETE SET NULL;
