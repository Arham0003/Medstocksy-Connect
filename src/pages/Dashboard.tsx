import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Megaphone, Send, ClipboardList, AlertTriangle, FileText, CheckCircle2, MessageSquare, Smartphone, PhoneCall, Check } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase, rpc } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ComposeDrawer } from '@/components/crm/ComposeDrawer';
import { CustomerPickerDialog } from '@/components/crm/CustomerPickerDialog';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { sendOrCompose, logManualSend } from '@/lib/api/messages';
import { markReminderSent, renderReminderMessage } from '@/lib/api/reminders';
import { cn } from '@/lib/utils';
import type { CustomerWithStats } from '@/lib/api/customers';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { RefillConversionChart } from '@/components/crm/RefillConversionChart';
import { PatientCohortChart } from '@/components/crm/PatientCohortChart';
import { useDashboardCharts } from '@/hooks/useDashboardCharts';

/**
 * ── Dashboard visual rules ───────────────────────────────────────────────
 * Per medstocksy_connect_theme.md, colour carries meaning here; it is not
 * decoration. The palette is deliberately four-wide:
 *
 *   foreground   default for every number — most stats mean nothing on their own
 *   primary      brand / interactive / "this is today"
 *   emerald      a good outcome (revenue up, nothing failed)
 *   amber        needs a human soon (due, overdue)
 *   destructive  something broke (failed sends)
 *
 * The previous tiles assigned a different hue per metric — teal customers,
 * violet visits, coral chronic — which made four unrelated things shout at
 * equal volume and left nothing for real status to say. Violet is also
 * reserved for the Chronic *tag* (theme §2.4), so spending it on "visits this
 * month" broke the tag mapping. Hierarchy now comes from size and position:
 * one hero number, then quiet supporting stats, then the work queue.
 */

/**
 * Quiet supporting stat. No icon chip, no coloured border, no per-metric hue —
 * these are context for the dashboard, so they read as a row of facts.
 */
function StatCell({
  label, value, sub, tone = 'default', onClick, loading = false,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone?: 'default' | 'attention';
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col items-start px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <span className={cn(
          'mono-num mt-1.5 text-2xl font-semibold leading-none tabular-nums',
          tone === 'attention' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
        )}>
          {value}
        </span>
      )}
      {loading ? (
        <Skeleton className="mt-1.5 h-3 w-20" />
      ) : (
        <span className="mt-1.5 truncate text-[11px] text-muted-foreground" title={sub}>
          {sub}
        </span>
      )}
    </button>
  );
}

/* ─── Recent Prescriptions widget ─────────────────────────────────────────── */
function RecentPrescriptions({
  pharmacyId,
  onNavigate,
}: { pharmacyId: string; onNavigate: (path: string) => void }) {
  interface RxRow {
    id: string;
    prescription_date: string;
    doctor_name: string | null;
    diagnosis: string | null;
    customer: { id: string; name: string } | null;
  }
  const { data: rxs = [], isLoading } = useQuery<RxRow[]>({
    queryKey: ['recent-prescriptions-dash', pharmacyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_prescriptions')
        .select('id, prescription_date, doctor_name, diagnosis, customer:crm_customers(id, name)')
        .eq('pharmacy_id', pharmacyId)
        .order('created_at', { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as unknown as RxRow[];
    },
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" /> Recent prescriptions
        </h2>
        <button onClick={() => onNavigate('/customers')} className="text-xs text-muted-foreground hover:text-primary">View all →</button>
      </div>
      <div className="divide-y">
        {isLoading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
          </div>
        )) : rxs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No prescriptions yet. Use Quick Rx to add one.</div>
        ) : rxs.map(rx => (
          <button key={rx.id} onClick={() => rx.customer && onNavigate(`/customers/${rx.customer.id}`)}
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {rx.customer?.name?.slice(0, 2).toUpperCase() ?? 'Rx'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{rx.customer?.name ?? '—'}</div>
              <div className="text-xs text-muted-foreground truncate">
                {rx.doctor_name ? `Dr. ${rx.doctor_name}` : 'No doctor'} · {rx.diagnosis ?? 'No diagnosis'}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              {new Date(rx.prescription_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ─── Failed Reminders widget ──────────────────────────────────────────────── */
function FailedReminders({
  pharmacyId,
  onNavigate,
}: { pharmacyId: string; onNavigate: (path: string) => void }) {
  interface FailedRow {
    id: string;
    scheduled_for: string;
    variables: Record<string, string>;
    customer: { id: string; name: string; phone: string } | null;
    template: { name: string } | null;
  }
  const { data: failed = [], isLoading } = useQuery<FailedRow[]>({
    queryKey: ['failed-reminders-dash', pharmacyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_scheduled_reminders')
        .select('id, scheduled_for, variables, customer:crm_customers(id, name, phone), template:crm_templates(name)')
        .eq('pharmacy_id', pharmacyId)
        .in('status', ['failed', 'cancelled'])
        .order('scheduled_for', { ascending: false })
        .limit(6);
      if (error) throw error;
      return (data ?? []) as unknown as FailedRow[];
    },
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Failed reminders
        </h2>
        <button onClick={() => onNavigate('/reminders')} className="text-xs text-muted-foreground hover:text-primary">Manage →</button>
      </div>
      <div className="divide-y">
        {isLoading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
          </div>
        )) : failed.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <div className="mt-2 text-sm font-medium">Nothing has failed</div>
            <div className="mt-1 text-xs text-muted-foreground">Every reminder so far went out.</div>
          </div>
        ) : failed.map(r => (
          <button key={r.id} onClick={() => r.customer && onNavigate(`/customers/${r.customer.id}`)}
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{r.customer?.name ?? '—'}</div>
              <div className="text-xs text-muted-foreground">
                {r.template?.name ?? '—'} · {r.variables?.medicine ?? ''}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              {new Date(r.scheduled_for).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

/** Type for the crm_dashboard_counts() RPC response. */
interface DashboardCounts {
  total_customers:     number;
  this_week:           number;
  today_pending:       number;
  today_sent:          number;
  visits_month:        number;
  chronic_count:       number;
  upcoming_7d:         number;
  revenue_today:       number;
  revenue_yesterday:   number;
  new_customers_today: number;
  msgs_out_today:      number;
  refills_today:       number;
  reminders_due_today: number;
}

export default function Dashboard() {
  const t = useT();
  const { pharmacyId, pharmacyName } = useActivePharmacy();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composeFor, setComposeFor] = useState<CustomerWithStats | null>(null);

  // ── Single RPC call replaces all 14 individual queries ──────────────
  const { data: counts, isLoading: loadingCounts } = useQuery<DashboardCounts>({
    queryKey: ['dashboard', pharmacyId],
    enabled: !!pharmacyId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc<DashboardCounts>('crm_dashboard_counts', {
        p_pharmacy_id: pharmacyId,
      });
      if (error) throw new Error(error.message);
      return data as DashboardCounts;
    },
  });

  // ── Dashboard Visual Charts Data ─────────────────────────────────────
  const { data: chartsData, isLoading: loadingCharts } = useDashboardCharts();

  // ── Realtime: invalidate dashboard on any relevant table change ──────
  useRealtimeInvalidate({ table: 'crm_customers',           pharmacyId, queryKeys: [['dashboard', pharmacyId], ['customers', pharmacyId], ['dashboard-charts-metrics', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_scheduled_reminders', pharmacyId, queryKeys: [['dashboard', pharmacyId], ['upcoming-reminders', pharmacyId], ['due-reminders', pharmacyId], ['dashboard-charts-metrics', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_customer_sales',      pharmacyId, queryKeys: [['dashboard', pharmacyId], ['dashboard-charts-metrics', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_prescription_refills',pharmacyId, queryKeys: [['dashboard', pharmacyId], ['dashboard-charts-metrics', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_tags',                pharmacyId, queryKeys: [['dashboard-charts-metrics', pharmacyId]] });

  interface UpcomingRow {
    id: string;
    scheduled_for: string;
    status: string;
    sent_at?: string | null;
    variables?: Record<string, string> | null;
    customer: { id: string; name: string; phone: string; whatsapp_opted_in: boolean };
    template: { name: string; body: string };
  }

  const { data: upcoming, isLoading: loadingReminders } = useQuery<UpcomingRow[]>({
    queryKey: ['upcoming-reminders', pharmacyId],
    enabled: !!pharmacyId,
    staleTime: 60_000,
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOf7d = new Date(Date.now() + 7 * 86400000);

      const { data, error } = await supabase
        .from('crm_scheduled_reminders')
        .select(`
          id, scheduled_for, status, sent_at, variables,
          customer:crm_customers!inner(id, name, phone, whatsapp_opted_in),
          template:crm_templates!inner(name, body)
        `)
        .eq('pharmacy_id', pharmacyId)
        .or(`and(status.eq.pending,scheduled_for.lt.${endOf7d.toISOString()}),and(status.in.(sent,converted),sent_at.gte.${startOfDay.toISOString()})`)
        .order('scheduled_for')
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as UpcomingRow[];
    },
  });

  // Auto-refresh dashboard when returning to tab
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') {
        for (const key of [
          'upcoming-reminders', 'due-reminders', 'dashboard-counts',
          'scheduled-reminders', 'reminders-today', 'reminders-overdue',
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

  // Quick WhatsApp send for a today's-reminder row — renders the template,
  // opens WhatsApp (bot or click-to-chat), logs the send, marks reminder sent.
  const quickWhatsApp = async (row: UpcomingRow) => {
    if (!row.customer.whatsapp_opted_in) return;
    const body = await renderReminderMessage({
      body: row.template.body,
      customerName: row.customer.name,
      customerPhone: row.customer.phone,
      storedVars: row.variables,
      pharmacyId,
    });
    const result = await sendOrCompose({ phone: row.customer.phone, body });
    const { messageId } = await logManualSend({
      pharmacyId,
      customerId: row.customer.id,
      phone: row.customer.phone,
      body,
    });
    await markReminderSent(row.id, result.messageId ?? messageId);
    for (const key of [
      'upcoming-reminders', 'due-reminders', 'dashboard-counts',
      'scheduled-reminders', 'reminders-today', 'reminders-overdue', 'messages',
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  // Start of tomorrow — a reminder is "due today / overdue" if it's before this.
  const endOfToday = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  })();

  const greeting = pharmacyName;
  const hour = new Date().getHours();
  const greetingPrefix = hour < 12 ? t('dash.greeting_morning') : hour < 17 ? t('dash.greeting_afternoon') : t('dash.greeting_evening');
  const subtitleText = counts
    ? t('dash.subtitle_template')
        .replace('{count}', String(counts.total_customers))
        .replace('{reminders}', String(counts.upcoming_7d))
    : '—';

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────
          Date + greeting (left) / action buttons (right)
          Gestalt: related items grouped, primary action visually dominant
      ── */}
      <header className="flex flex-wrap items-start justify-between gap-4 pb-2 border-b">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          </p>
          <h1 className="mt-1 text-[1.75rem] font-bold tracking-tight text-foreground">{greetingPrefix}, {greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitleText}</p>
        </div>
        {/* Action strip — Quick Rx primary (most-used), others secondary */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="gap-2">
            <Send className="h-3.5 w-3.5" />
            {t('btn.new_message')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/campaigns')} className="gap-2">
            <Megaphone className="h-3.5 w-3.5" />
            {t('btn.new_campaign')}
          </Button>
          <Button size="sm" onClick={() => navigate('/rx')} className="gap-2">
            <ClipboardList className="h-3.5 w-3.5" />
            Quick Rx
          </Button>
        </div>
      </header>

      {/* ── Practice stats ──────────────────────────────────────────────
          Standing totals — deliberately one quiet card rather than competing tiles.
      ── */}
      <Card className="grid grid-cols-2 divide-x divide-y overflow-hidden md:grid-cols-4 md:divide-y-0">
        <StatCell
          label={t('dash.kpi.customers')}
          value={counts?.total_customers != null ? counts.total_customers.toLocaleString('en-IN') : '—'}
          sub={`+${counts?.this_week ?? 0} ${t('dash.this_week')}`}
          loading={loadingCounts}
          onClick={() => navigate('/customers')}
        />
        <StatCell
          label={t('dash.kpi.reminders')}
          value={counts?.today_pending ?? '—'}
          sub={`${counts?.today_sent ?? 0} ${t('dash.sent')} ${t('dash.today')}`}
          tone={counts && counts.today_pending > 0 ? 'attention' : 'default'}
          loading={loadingCounts}
          onClick={() => navigate('/reminders')}
        />
        <StatCell
          label={t('dash.kpi.visits_month')}
          value={counts?.visits_month != null ? counts.visits_month.toLocaleString('en-IN') : '—'}
          sub={t('dash.total_visits')}
          loading={loadingCounts}
          onClick={() => navigate('/activity')}
        />
        <StatCell
          label={t('dash.kpi.chronic')}
          value={counts?.chronic_count ?? '—'}
          sub={`${counts && counts.total_customers > 0 ? Math.round((counts.chronic_count / counts.total_customers) * 100) : 0}% ${t('dash.of_total')}`}
          loading={loadingCounts}
          onClick={() => navigate('/customers?segment=chronic')}
        />
      </Card>

      {/* ── Visual Analytics: Refill Conversion & Cohorts ────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RefillConversionChart
          data={chartsData?.timeline}
          overallConversionRate={chartsData?.overallConversionRate ?? 0}
          totalReminders={chartsData?.totalReminders ?? 0}
          totalRefills={chartsData?.totalRefills ?? 0}
          isLoading={loadingCharts}
        />
        <PatientCohortChart
          cohorts={chartsData?.cohorts}
          chronicPercentage={chartsData?.chronicPercentage ?? 0}
          totalCustomers={chartsData?.totalCustomers ?? 0}
          isLoading={loadingCharts}
        />
      </div>

      {/* Upcoming reminders — full width */}
      <Card>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">{t('dash.upcoming.title')}</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate('/reminders')}>
            {t('btn.view_all')} →
          </Button>
        </div>
        <div className="divide-y">
          {loadingReminders ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))
          ) : upcoming && upcoming.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((row) => (
                <div
                  key={row.id}
                  className="flex w-full min-w-0 items-center gap-3 border-b p-4 transition-colors hover:bg-muted/40 sm:border-r last:border-b-0"
                >
                  <button
                    onClick={() => navigate(`/customers/${row.customer.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                      {row.variables?.channel === 'whatsapp' ? <MessageSquare className="h-4 w-4 text-emerald-600" />
                        : row.variables?.channel === 'sms' ? <Smartphone className="h-4 w-4 text-blue-600" />
                        : row.variables?.channel === 'call' ? <PhoneCall className="h-4 w-4 text-amber-600" />
                        : <BellRing className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{row.customer.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.variables?.medicine || 'Reminder'} · {row.template.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className={cn(
                          'text-[11px] font-mono',
                          row.status === 'pending' && new Date(row.scheduled_for) < endOfToday ? 'text-destructive font-semibold' : 'text-muted-foreground'
                        )}>
                          {new Date(row.scheduled_for).toLocaleString('en-IN', {
                            day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                          })}
                        </span>
                        {row.status === 'pending' && new Date(row.scheduled_for) < new Date() && (
                          <span className="rounded bg-destructive/10 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-destructive">
                            overdue
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Sent badge or Quick WhatsApp send button */}
                  {row.status === 'sent' || row.status === 'converted' ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <Check className="h-3 w-3" /> Done
                    </span>
                  ) : new Date(row.scheduled_for) < endOfToday ? (
                    <button
                      type="button"
                      onClick={() => quickWhatsApp(row)}
                      disabled={!row.customer.whatsapp_opted_in}
                      aria-label={t('dash.quick_whatsapp')}
                      title={row.customer.whatsapp_opted_in ? t('dash.quick_whatsapp') : t('bell.opted_out')}
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                        row.customer.whatsapp_opted_in
                          ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'
                          : 'cursor-not-allowed bg-muted text-muted-foreground/50'
                      )}
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">{t('dash.upcoming.empty')}</div>
          )}
        </div>
      </Card>

      {/* Bottom row: recent prescriptions + failed reminders */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Prescriptions */}
        <RecentPrescriptions pharmacyId={pharmacyId} onNavigate={navigate} />
        {/* Failed Reminders */}
        <FailedReminders pharmacyId={pharmacyId} onNavigate={navigate} />
      </div>

      {/* "New message" flow: pick a customer → open compose drawer */}
      <CustomerPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(c) => {
          setPickerOpen(false);
          setComposeFor(c);
        }}
      />
      {composeFor && (
        <ComposeDrawer
          open={!!composeFor}
          onClose={() => setComposeFor(null)}
          customer={{
            id: composeFor.id,
            name: composeFor.name,
            phone: composeFor.phone,
            whatsapp_opted_in: composeFor.whatsapp_opted_in,
          }}
        />
      )}
    </div>
  );
}
