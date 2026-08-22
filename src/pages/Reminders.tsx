import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, BellRing, Clock, CheckCircle2, XCircle, AlertTriangle,
  MessageSquare, PhoneCall, Smartphone, RefreshCcw, ChevronRight, Send, Check
} from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { supabase, type Tables } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ReminderRuleDialog } from '@/components/crm/ReminderRuleDialog';
import { BulkReminderSendDialog } from '@/components/crm/BulkReminderSendDialog';
import { RescheduleReminderDialog } from '@/components/crm/RescheduleReminderDialog';
import { useT } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { logManualSend, openWhatsAppCompose } from '@/lib/api/messages';
import { renderReminderMessage } from '@/lib/api/reminders';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

type Rule = Tables<'crm_reminder_rules'>;
type ReminderStatus = 'pending' | 'sent' | 'failed' | 'cancelled' | 'converted';

interface ScheduledReminder {
  id: string;
  scheduled_for: string;
  status: ReminderStatus;
  sent_at: string | null;
  variables: Record<string, string>;
  customer: { id: string; name: string; phone: string; whatsapp_opted_in?: boolean } | null;
  template: { name: string; body?: string } | null;
}

type Tab = 'today' | 'upcoming' | 'sent' | 'failed' | 'rules';

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />,
  sms: <Smartphone className="h-3.5 w-3.5 text-blue-600" />,
  call: <PhoneCall className="h-3.5 w-3.5 text-amber-600" />,
};

const STATUS_STYLES: Record<ReminderStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
  converted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

function formatRelative(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (diff === 0) return 'Today ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Tomorrow ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  if (diff === -1) return 'Yesterday ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** Shared hook — renders body via renderReminderMessage (same as bell),
 *  opens the right channel, marks sent in DB, logs the send. */
function useMarkReminderSent(pharmacyId: string, onToast?: (msg: string) => void) {
  const qc = useQueryClient();
  return useMutation<void, Error, ScheduledReminder>({
    mutationFn: async (row) => {
      const body = row.template?.body
        ? await renderReminderMessage({
            body: row.template.body,
            customerName: row.customer?.name,
            customerPhone: row.customer?.phone,
            storedVars: row.variables,
            pharmacyId,
          })
        : '';

      const channel = (row.variables?.channel as string) ?? 'whatsapp';
      if (row.customer?.phone) {
        const phone = row.customer.phone.replace(/\D/g, '');
        if (channel === 'whatsapp') {
          openWhatsAppCompose({ phone: row.customer.phone, body });
        } else if (channel === 'sms') {
          window.open(`sms:${phone}?body=${encodeURIComponent(body)}`, '_self');
        } else if (channel === 'call') {
          window.open(`tel:${phone}`, '_self');
        }
      }

      const { error } = await supabase.from('crm_scheduled_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() } as never).eq('id', row.id);
      if (error) throw new Error(error.message);

      if (row.customer) {
        await logManualSend({
          pharmacyId,
          customerId: row.customer.id,
          phone: row.customer.phone,
          body,
        }).catch((e) => console.warn('[manual send] log failed:', e));
      }
    },
    onSuccess: () => {
      for (const key of [
        'scheduled-reminders', 'reminders-today', 'reminders-overdue',
        'due-reminders', 'dashboard-counts', 'upcoming-reminders', 'messages', 'reminders-failed-count',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onToast?.('Reminder marked as sent ✓');
    },
  });
}

function ReminderRow({
  row,
  onRetry,
  onSend,
  onReschedule,
  isOverdue,
}: {
  row: ScheduledReminder;
  onRetry?: () => void;
  onSend?: () => void;
  onReschedule?: () => void;
  isOverdue?: boolean;
}) {
  const navigate = useNavigate();
  const channel = (row.variables?.channel as string) ?? 'whatsapp';
  const medicine = (row.variables?.medicine as string) ?? '';
  const isSent = row.status === 'sent' || row.status === 'converted';

  return (
    <div className={cn(
      'flex flex-wrap items-center gap-3 p-4 border-b last:border-0 hover:bg-muted/30 transition-colors',
      isOverdue && 'border-l-2 border-l-destructive bg-destructive/5',
      isSent && 'bg-emerald-500/[0.03]'
    )}>
      <div className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
        isSent ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted'
      )}>
        {isSent ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : (CHANNEL_ICONS[channel] ?? <BellRing className="h-3.5 w-3.5" />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{row.customer?.name ?? '—'}</span>
          {medicine && (
            <span className="rounded-full bg-primary/10 px-2 py-px text-[10px] font-medium text-primary">{medicine}</span>
          )}
          <span className={cn('rounded-full px-2 py-px text-[10px] font-bold uppercase inline-flex items-center gap-1', STATUS_STYLES[row.status])}>
            {isSent && <Check className="h-2.5 w-2.5" />}
            {row.status}
          </span>
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">
          {row.customer?.phone} · {row.template?.name ?? 'No template'} · {formatRelative(row.scheduled_for)}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isSent && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5" /> Done
          </span>
        )}
        {row.status === 'pending' && onSend && (
          <Button size="sm" onClick={() => onSend?.()} className="h-7 gap-1 text-xs bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary">
            <Send className="h-3 w-3" /> Send
          </Button>
        )}
        {(row.status === 'pending' || row.status === 'failed') && onReschedule && (
          <Button variant="outline" size="sm" onClick={onReschedule} className="h-7 gap-1 text-xs">
            <Clock className="h-3 w-3" /> Reschedule
          </Button>
        )}
        {row.status === 'failed' && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-7 gap-1 text-xs">
            <RefreshCcw className="h-3 w-3" /> Retry
          </Button>
        )}
        {row.customer?.id && (
          <button onClick={() => navigate(`/customers/${row.customer!.id}`)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ScheduledList({ pharmacyId, statusFilter }: { pharmacyId: string; statusFilter: ReminderStatus[] }) {
  const qc = useQueryClient();
  const [rescheduleRow, setRescheduleRow] = useState<ScheduledReminder | null>(null);

  const { data: rows = [], isLoading } = useQuery<ScheduledReminder[]>({
    queryKey: ['scheduled-reminders', pharmacyId, statusFilter.join(',')],
    queryFn: async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      if (statusFilter.includes('failed')) {
        // Failed tab: include both explicit failed/cancelled AND un-sent overdue from past days
        const { data: failedData, error: err1 } = await supabase
          .from('crm_scheduled_reminders')
          .select('id, template_id, scheduled_for, status, sent_at, variables, customer:crm_customers(id, name, phone, whatsapp_opted_in), template:crm_templates(name, body)')
          .eq('pharmacy_id', pharmacyId)
          .in('status', ['failed', 'cancelled'])
          .order('scheduled_for', { ascending: false })
          .limit(50);
        if (err1) throw err1;

        const { data: overdueData, error: err2 } = await supabase
          .from('crm_scheduled_reminders')
          .select('id, template_id, scheduled_for, status, sent_at, variables, customer:crm_customers(id, name, phone, whatsapp_opted_in), template:crm_templates(name, body)')
          .eq('pharmacy_id', pharmacyId)
          .eq('status', 'pending')
          .lt('scheduled_for', startOfToday.toISOString())
          .order('scheduled_for', { ascending: false })
          .limit(50);
        if (err2) throw err2;

        const combined = [...(overdueData ?? []), ...(failedData ?? [])];
        return (combined as unknown) as ScheduledReminder[];
      }

      let q = supabase
        .from('crm_scheduled_reminders')
        .select('id, template_id, scheduled_for, status, sent_at, variables, customer:crm_customers(id, name, phone, whatsapp_opted_in), template:crm_templates(name, body)')
        .eq('pharmacy_id', pharmacyId)
        .in('status', statusFilter)
        .order('scheduled_for', { ascending: statusFilter.includes('pending') });

      if (statusFilter.includes('pending') && statusFilter.length === 1) {
        // upcoming: only future reminders (on or after start of tomorrow)
        const startOfTomorrow = new Date();
        startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
        startOfTomorrow.setHours(0, 0, 0, 0);
        q = q.gte('scheduled_for', startOfTomorrow.toISOString())
             .lt('scheduled_for', new Date(Date.now() + 30 * 86400000).toISOString());
      }

      const { data, error } = await q.limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as ScheduledReminder[];
    },
  });

  const retry = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await supabase.from('crm_scheduled_reminders')
        .update({ status: 'pending', sent_at: null } as never).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-reminders'] });
      qc.invalidateQueries({ queryKey: ['reminders-failed-count'] });
    },
  });

  const markSent = useMarkReminderSent(pharmacyId);

  if (isLoading) return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
    </div>
  );

  if (rows.length === 0) return (
    <div className="py-12 text-center text-sm text-muted-foreground">No reminders in this category</div>
  );

  return (
    <>
      <div className="divide-y">
        {rows.map(r => (
          <ReminderRow 
            key={r.id} 
            row={r} 
            isOverdue={r.status === 'pending' && new Date(r.scheduled_for) < new Date()}
            onRetry={r.status === 'failed' ? () => retry.mutate(r.id) : undefined} 
            onSend={r.status === 'pending' ? () => markSent.mutate(r) : undefined}
            onReschedule={() => setRescheduleRow(r)}
          />
        ))}
      </div>
      <RescheduleReminderDialog
        open={!!rescheduleRow}
        onOpenChange={(v) => { if (!v) setRescheduleRow(null); }}
        reminder={rescheduleRow}
      />
    </>
  );
}

function TodayList({ pharmacyId }: { pharmacyId: string }) {
  const t = useT();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rescheduleRow, setRescheduleRow] = useState<ScheduledReminder | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  // Fetch today's reminders (all statuses: pending, sent, failed) — sent items stay visible today with Done mark
  const { data: todayRows = [], isLoading: loadingToday } = useQuery<ScheduledReminder[]>({
    queryKey: ['reminders-today', pharmacyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_scheduled_reminders')
        .select('id, template_id, scheduled_for, status, sent_at, variables, customer:crm_customers(id, name, phone, whatsapp_opted_in), template:crm_templates(name, body)')
        .eq('pharmacy_id', pharmacyId)
        .gte('scheduled_for', start)
        .lt('scheduled_for', end)
        .order('scheduled_for');
      if (error) throw error;
      return (data ?? []) as unknown as ScheduledReminder[];
    },
  });

  // Fetch overdue reminders (anything before start of today, still pending)
  const { data: overdueRows = [], isLoading: loadingOverdue } = useQuery<ScheduledReminder[]>({
    queryKey: ['reminders-overdue', pharmacyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_scheduled_reminders')
        .select('id, template_id, scheduled_for, status, sent_at, variables, customer:crm_customers(id, name, phone, whatsapp_opted_in), template:crm_templates(name, body)')
        .eq('pharmacy_id', pharmacyId)
        .eq('status', 'pending')
        .lt('scheduled_for', start)
        .order('scheduled_for', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as ScheduledReminder[];
    },
  });

  const markSent = useMarkReminderSent(pharmacyId, showToast);

  const isLoading = loadingToday || loadingOverdue;

  if (isLoading) return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
    </div>
  );

  const pending = todayRows.filter(r => r.status === 'pending');
  const sent = todayRows.filter(r => r.status === 'sent');
  const failed = todayRows.filter(r => r.status === 'failed');

  const totalToday = todayRows.length;
  const totalOverdue = overdueRows.length;

  // Everything still owed to a patient right now — overdue first, then today.
  // The bulk dialog filters this further (opt-out, missing phone, non-WA).
  const allPending = [...overdueRows, ...pending];

  return (
    <div className="relative">
      {/* Send confirmation toast — 3s auto-dismiss */}
      {toast && (
        <div className="absolute left-4 right-4 top-2 z-10 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg animate-fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {toast}
        </div>
      )}
      {allPending.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b bg-primary/5 px-4 py-2.5">
          <span className="text-xs font-semibold text-muted-foreground">
            {allPending.length} {allPending.length === 1 ? 'reminder' : 'reminders'} waiting to be sent
          </span>
          <Button size="sm" onClick={() => setBulkOpen(true)} className="h-7 gap-1.5 text-xs">
            <Send className="h-3 w-3" /> {t('rem.bulk.button')}
          </Button>
        </div>
      )}

      <BulkReminderSendDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        pharmacyId={pharmacyId}
        reminders={allPending}
      />

      <RescheduleReminderDialog
        open={!!rescheduleRow}
        onOpenChange={(v) => { if (!v) setRescheduleRow(null); }}
        reminder={rescheduleRow}
      />

      {/* Overdue section — shown prominently if overdue items exist */}
      {totalOverdue > 0 && (
        <div>
          <div className="flex items-center gap-2 border-b bg-destructive/8 px-4 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs font-bold text-destructive">
              {totalOverdue} overdue reminder{totalOverdue !== 1 ? 's' : ''} — not sent yet
            </span>
          </div>
          <div className="divide-y">
            {overdueRows.map(r => (
              <ReminderRow
                key={r.id}
                row={r}
                isOverdue
                onSend={r.status === 'pending' ? () => markSent.mutate(r) : undefined}
                onReschedule={() => setRescheduleRow(r)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Today section */}
      {totalToday > 0 ? (
        <div>
          {totalOverdue > 0 && (
            <div className="border-b bg-muted/20 px-4 py-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Today</span>
            </div>
          )}
          {/* Summary pills */}
          <div className="flex gap-3 px-4 py-3 border-b bg-muted/20">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
              <Clock className="h-3.5 w-3.5" /> {pending.length} pending
            </span>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> {sent.length} sent
            </span>
            {failed.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                <XCircle className="h-3.5 w-3.5" /> {failed.length} failed
              </span>
            )}
          </div>
          <div className="divide-y">
            {todayRows.map(r => (
              <ReminderRow
                key={r.id}
                row={r}
                onSend={r.status === 'pending' ? () => markSent.mutate(r) : undefined}
                onReschedule={() => setRescheduleRow(r)}
              />
            ))}
          </div>
        </div>
      ) : totalOverdue === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No reminders scheduled for today 🎉</div>
      ) : null}
    </div>
  );
}

function RulesTab({ pharmacyId, role }: { pharmacyId: string; role: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const isAdmin = role === 'admin' || role === 'manager';

  const { data: rules = [], isLoading } = useQuery<(Rule & { template?: { name: string } | null })[]>({
    queryKey: ['reminder-rules', pharmacyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_reminder_rules')
        .select('*, template:crm_templates(name)')
        .eq('pharmacy_id', pharmacyId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (Rule & { template?: { name: string } | null })[];
    },
  });

  return (
    <div className="space-y-3 p-4">
      {isAdmin && (
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} size="sm">
          <Plus className="h-4 w-4" /> New rule
        </Button>
      )}
      {isLoading ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16" />) :
        rules.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No rules yet. Add a rule to auto-schedule reminders.</div>
        ) : rules.map(r => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border bg-card p-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                  <MessageSquare className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{r.medicine_label}</span>
                    <span className={cn('rounded-full px-2 py-px text-[10px] font-bold uppercase',
                      r.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>
                      {r.is_active ? 'Active' : 'Off'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Every <span className="font-mono">{r.refill_cycle_days}</span>d · remind <span className="font-mono">{r.reminder_offset_days}</span>d before · {r.template?.name ?? '—'} · {r.send_time.slice(0, 5)}
                  </p>
                </div>
              </div>
            </div>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => { setEditing(r); setDialogOpen(true); }}>Edit</Button>
            )}
          </div>
        ))
      }
      <ReminderRuleDialog open={dialogOpen} onOpenChange={setDialogOpen} rule={editing} />
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────── */
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'today', label: 'Today', icon: <Clock className="h-3.5 w-3.5" /> },
  { id: 'upcoming', label: 'Upcoming', icon: <BellRing className="h-3.5 w-3.5" /> },
  { id: 'sent', label: 'Sent', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { id: 'failed', label: 'Failed', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  { id: 'rules', label: 'Rules', icon: <RefreshCcw className="h-3.5 w-3.5" /> },
];

export default function Reminders() {
  const { pharmacyId, role } = useActivePharmacy();
  const [tab, setTab] = useState<Tab>('today');
  const qc = useQueryClient();

  // Failed / overdue count for the tab red badge
  const { data: failedCount = 0 } = useQuery<number>({
    queryKey: ['reminders-failed-count', pharmacyId],
    queryFn: async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const { count: failedC } = await supabase
        .from('crm_scheduled_reminders')
        .select('*', { count: 'exact', head: true })
        .eq('pharmacy_id', pharmacyId)
        .in('status', ['failed', 'cancelled']);

      const { count: overdueC } = await supabase
        .from('crm_scheduled_reminders')
        .select('*', { count: 'exact', head: true })
        .eq('pharmacy_id', pharmacyId)
        .eq('status', 'pending')
        .lt('scheduled_for', startOfToday.toISOString());

      return (failedC ?? 0) + (overdueC ?? 0);
    },
    enabled: !!pharmacyId,
  });

  useRealtimeInvalidate({
    table: 'crm_scheduled_reminders',
    pharmacyId,
    queryKeys: [
      ['scheduled-reminders'],
      ['reminders-today'],
      ['reminders-overdue'],
      ['due-reminders'],
      ['dashboard-counts'],
      ['upcoming-reminders'],
      ['reminders-failed-count'],
    ],
  });

  // Auto-refresh reminders as soon as staff returns to this app tab
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') {
        for (const key of [
          'scheduled-reminders', 'reminders-today', 'reminders-overdue',
          'due-reminders', 'dashboard-counts', 'upcoming-reminders', 'reminders-failed-count',
        ]) {
          qc.invalidateQueries({ queryKey: [key] });
        }
      }
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [qc]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Customer relations</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Reminders</h1>
          <p className="mt-1 text-sm text-muted-foreground">Today's reminders, upcoming refills, and rule management</p>
        </div>
      </header>

      {/* Channel Connectivity Status Bar */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-3">
        {(Object.entries(CHANNEL_ICONS) as [string, React.ReactNode][]).map(([id, icon]) => (
          <Card key={id} className="flex items-center gap-3 p-3 transition-colors hover:border-primary/30">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {id}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="truncate text-xs font-medium">Connected</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        {/* Tab bar — horizontally scrollable on phones */}
        <div className="flex overflow-x-auto border-b bg-muted/20 scrollbar-none">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                'flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-medium transition-colors sm:px-4 sm:text-sm',
                tab === t.id
                  ? 'border-primary text-primary bg-background'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}>
              {t.icon}
              {t.label}
              {t.id === 'failed' && failedCount > 0 && (
                <span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-sm animate-pulse">
                  {failedCount > 99 ? '99+' : failedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'today' && <TodayList pharmacyId={pharmacyId} />}
        {tab === 'upcoming' && <ScheduledList pharmacyId={pharmacyId} statusFilter={['pending']} />}
        {tab === 'sent' && <ScheduledList pharmacyId={pharmacyId} statusFilter={['sent', 'converted']} />}
        {tab === 'failed' && <ScheduledList pharmacyId={pharmacyId} statusFilter={['failed', 'cancelled']} />}
        {tab === 'rules' && <RulesTab pharmacyId={pharmacyId} role={role ?? ' staff'} />}

        {/* Legend / Connecting info */}
        <div className="flex flex-wrap items-center gap-4 border-t bg-muted/10 px-4 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Supported Channels:</span>
          {Object.entries(CHANNEL_ICONS).map(([id, icon]) => (
            <div key={id} className="flex items-center gap-1.5 opacity-60 transition-opacity hover:opacity-100">
              {icon}
              <span className="text-[10px] font-medium capitalize">{id}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
