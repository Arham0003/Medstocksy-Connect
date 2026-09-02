/**
 * Staff / member management for Settings (audit Phase 1 #3).
 *
 * Non-admins get a read-only roster: RLS would reject their writes anyway,
 * so the controls are hidden rather than shown-then-failing.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Loader2, Trash2, Mail, ShieldCheck, Clock, AlertTriangle,
} from 'lucide-react';
import {
  listMembers, inviteMember, revokeInvite, updateMemberRole, removeMember,
  type MemberRole,
} from '@/lib/api/members';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const ROLES: MemberRole[] = ['admin', 'manager', 'staff'];

const ROLE_STYLE: Record<MemberRole, string> = {
  admin: 'bg-primary/10 text-primary',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  staff: 'bg-muted text-muted-foreground',
};

export function MembersSection({ pharmacyId, isAdmin }: { pharmacyId: string; isAdmin: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('staff');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Confirmation state
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<{ id: string; next: MemberRole; prev: MemberRole } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['members', pharmacyId],
    enabled: !!pharmacyId,
    queryFn: () => listMembers(pharmacyId),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['members', pharmacyId] });

  const invite = useMutation({
    mutationFn: () =>
      inviteMember({ pharmacyId, email, role, invitedBy: user!.id }),
    onSuccess: () => {
      setNotice(t('settings.members.invited').replace('{email}', email.trim()));
      setEmail('');
      setError(null);
      refresh();
    },
    onError: (e: Error) => { setError(e.message); setNotice(null); },
  });

  const revoke = useMutation({
    mutationFn: revokeInvite,
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, next }: { id: string; next: MemberRole }) => updateMemberRole(id, next),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: removeMember,
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    // Deliberately loose: the real check is that Supabase Auth confirmed this
    // exact address before the invite can ever be claimed.
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t('settings.members.bad_email'));
      return;
    }
    invite.mutate();
  };

  const members = data?.members ?? [];
  const invites = data?.invites ?? [];
  const adminCount = members.filter((m) => m.role === 'admin').length;

  return (
    <>
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-lg font-bold">{t('settings.members.heading')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.members.desc')}</p>
      </div>

      {isAdmin && (
        <form onSubmit={submitInvite} className="mb-6 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('settings.members.email_placeholder')}
              className="pl-9"
            />
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{t(`settings.members.role.${r}` as 'settings.members.role.staff')}</option>
            ))}
          </select>
          <Button type="submit" disabled={invite.isPending} className="gap-2">
            {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t('settings.members.invite')}
          </Button>
        </form>
      )}

      {notice && (
        <p className="mb-4 rounded-md border border-emerald-300/60 bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice} {t('settings.members.invite_hint')}
        </p>
      )}

      {error && (
        <p className="mb-4 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {members.map((m) => {
            // Never let the last admin strip their own admin rights or delete
            // themselves — that would leave the pharmacy unmanageable.
            const lastAdmin = m.role === 'admin' && adminCount <= 1;
            const locked = m.is_owner || lastAdmin;

            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {m.email ?? '—'}
                    </span>
                    {m.is_self && (
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-bold uppercase text-muted-foreground">
                        {t('settings.members.you')}
                      </span>
                    )}
                    {m.is_owner && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-bold uppercase text-primary">
                        <ShieldCheck className="h-3 w-3" /> {t('settings.members.owner')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {t('settings.members.joined')} {new Date(m.joined_at).toLocaleDateString('en-IN')}
                  </div>
                </div>

                {isAdmin && !locked ? (
                  <select
                    value={m.role}
                    onChange={(e) => {
                      const next = e.target.value as MemberRole;
                      if (next !== m.role) setPendingRole({ id: m.id, next, prev: m.role });
                    }}
                    disabled={changeRole.isPending}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{t(`settings.members.role.${r}` as 'settings.members.role.staff')}</option>
                    ))}
                  </select>
                ) : (
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', ROLE_STYLE[m.role])}>
                    {t(`settings.members.role.${m.role}` as 'settings.members.role.staff')}
                  </span>
                )}

                {isAdmin && !locked && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(m.id)}
                    disabled={remove.isPending}
                    aria-label={t('settings.members.remove')}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}

          {invites.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center gap-3 bg-muted/30 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span className="truncate text-sm font-medium">{inv.email}</span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    {t('settings.members.pending')}
                  </span>
                </div>
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', ROLE_STYLE[inv.role])}>
                {t(`settings.members.role.${inv.role}` as 'settings.members.role.staff')}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setConfirmRevokeId(inv.id)}
                  disabled={revoke.isPending}
                  aria-label={t('settings.members.revoke')}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isAdmin && (
        <p className="mt-4 text-xs text-muted-foreground">{t('settings.members.readonly')}</p>
      )}
    </Card>

    <ConfirmDialog
      open={confirmRemoveId !== null}
      title="Remove this member?"
      description="They will lose access to this pharmacy immediately."
      confirmLabel="Yes, remove"
      cancelLabel="No"
      isPending={remove.isPending}
      onConfirm={() => { if (confirmRemoveId) remove.mutate(confirmRemoveId); setConfirmRemoveId(null); }}
      onCancel={() => setConfirmRemoveId(null)}
    />

    <ConfirmDialog
      open={confirmRevokeId !== null}
      title="Revoke this invitation?"
      description="The invitation link will be cancelled."
      confirmLabel="Yes, revoke"
      cancelLabel="No"
      isPending={revoke.isPending}
      onConfirm={() => { if (confirmRevokeId) revoke.mutate(confirmRevokeId); setConfirmRevokeId(null); }}
      onCancel={() => setConfirmRevokeId(null)}
    />

    <ConfirmDialog
      open={pendingRole !== null}
      title={`Change role to ${pendingRole?.next ?? ''}?`}
      description="This will update the member's access level."
      confirmLabel="Yes"
      cancelLabel="No"
      isPending={changeRole.isPending}
      onConfirm={() => { if (pendingRole) changeRole.mutate({ id: pendingRole.id, next: pendingRole.next }); setPendingRole(null); }}
      onCancel={() => setPendingRole(null)}
    />
  </>
  );
}
