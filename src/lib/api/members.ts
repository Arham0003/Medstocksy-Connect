/**
 * Staff / member management.
 *
 * Reads go through `crm_list_members` because member emails live in
 * auth.users, which authenticated clients cannot select from directly.
 * Writes go straight to the tables — RLS already restricts them to admins
 * (`members_admin_write`, `invites_admin_write`).
 */
import { supabase, rpc } from '@/lib/supabase';

export type MemberRole = 'admin' | 'manager' | 'staff';

export interface Member {
  id: string;
  user_id: string;
  email: string | null;
  role: MemberRole;
  joined_at: string;
  /** Pharmacy owner — cannot be demoted or removed. */
  is_owner: boolean;
  /** The signed-in user, so the UI can stop them locking themselves out. */
  is_self: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  created_at: string;
}

export async function listMembers(
  pharmacyId: string
): Promise<{ members: Member[]; invites: PendingInvite[] }> {
  const { data, error } = await rpc<{ members: Member[]; invites: PendingInvite[] }>(
    'crm_list_members',
    { p_pharmacy_id: pharmacyId }
  );
  if (error) throw new Error(error.message);
  return { members: data?.members ?? [], invites: data?.invites ?? [] };
}

export async function inviteMember(args: {
  pharmacyId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
}): Promise<void> {
  const { error } = await supabase.from('crm_invites').insert({
    pharmacy_id: args.pharmacyId,
    email: args.email.trim().toLowerCase(),
    role: args.role,
    invited_by: args.invitedBy,
  } as never);

  if (error) {
    // 23505 = the partial unique index on (pharmacy_id, lower(email)) where
    // accepted_at IS NULL. Means an invite for this address is already open.
    if (error.code === '23505') {
      throw new Error('An invite for that email is already pending.');
    }
    throw new Error(error.message);
  }
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from('crm_invites').delete().eq('id', inviteId);
  if (error) throw new Error(error.message);
}

export async function updateMemberRole(memberId: string, role: MemberRole): Promise<void> {
  const { error } = await supabase
    .from('crm_members')
    .update({ role } as never)
    .eq('id', memberId);
  if (error) throw new Error(error.message);
}

export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('crm_members').delete().eq('id', memberId);
  if (error) throw new Error(error.message);
}

/**
 * Turn any invite addressed to the signed-in user's verified email into a
 * membership. Safe to call on every app load — it is a no-op when there is
 * nothing pending. Returns the number claimed.
 */
export async function claimInvites(): Promise<number> {
  const { data, error } = await rpc<number>('crm_claim_invites', {});
  if (error) throw new Error(error.message);
  return data ?? 0;
}
