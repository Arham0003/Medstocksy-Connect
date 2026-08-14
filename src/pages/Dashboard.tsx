import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Megaphone, Send, ClipboardList, AlertTriangle, FileText, CheckCircle2, MessageSquare, Smartphone, PhoneCall, ArrowUpRight, ArrowDownRight } from 'lucide-react';
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
import { cn, formatINR } from '@/lib/utils';
import type { CustomerWithStats } from '@/lib/api/customers';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

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

/** One day in the 7-day revenue trend. */
interface DayPoint {
  /** Local YYYY-MM-DD, used only as a React key. */
  key: string;
  /** Short weekday label, e.g. "Mon". */
  label: string;
  total: number;
  isToday: boolean;
}

/**
 * Simple bars for the last 7 days of revenue.
 *
 * Theme §11 permits "simple bars/numbers" and no more, and the audit called
 * out the total absence of trend visualisation (§9) as a top gap — a single
 * "revenue today" figure cannot tell a slow Tuesday from a collapsing week.
 */
function RevenueTrend({ days, loading }: { days: DayPoint[]; loading: boolean }) {
  const t = useT();
  if (loading) return <Skeleton className="h-[68px] w-full sm:w-[260px]" />;

  const peak = Math.max(...days.map((d) => d.total), 1);

  return (
    <div className="w-full sm:w-[260px]">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('dash.trend.label')}
        </span>
        <span className="mono-num text-[10px] tabular-nums text-muted-foreground">
          {t('dash.trend.peak')} {formatINRCompact(peak)}
        </span>
      </div>
      <div className="flex h-11 items-end gap-1.5" role="img" aria-label={t('dash.trend.label')}>
        {days.map((d) => (
          <div key={d.key} className="group relative flex flex-1 flex-col items-center gap-1">
            <div
              // min-height keeps a zero day visible as a baseline tick rather
              // than a gap the eye reads as missing data.
              className={cn(
                'w-full rounded-sm transition-colors',
                d.isToday ? 'bg-primary' : 'bg-muted-foreground/25 group-hover:bg-muted-foreground/40'
              )}
              style={{ height: `${Math.max((d.total / peak) * 100, 4)}%` }}
              title={`${d.label}: ${formatINRCompact(d.total)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {days.map((d) => (
          <span
            key={d.key}
            className={cn(
              'flex-1 text-center text-[9px] font-medium',
              d.isToday ? 'text-primary' : 'text-muted-foreground/70'
            )}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Quiet supporting stat. No icon chip, no coloured border, no per-metric hue —
 * these are context for the hero number, so they read as a row of facts.
 */
function StatCell({
  label, value, sub, tone = 'default', onClick,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone?: 'default' | 'attention';
  onClick?: () => void;
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
      <span className={cn(
        'mono-num mt-1.5 text-2xl font-semibold leading-none tabular-nums',
        tone === 'attention' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
      )}>
        {value}
      </span>
      <span className="mt-1.5 truncate text-[11px] text-muted-foreground" title={sub}>
        {sub}
      </span>
    </button>
  );
}

/**
 * Hero panel. Today's revenue is the one number a pharmacy owner opens this
 * screen for, so it gets display size and the only elevated surface on the
 * page (theme §4: "at most one elevated layer per screen"). Everything else
 * on the dashboard steps down from here.
 */
function TodayPanel({
  dash, isLoading, trend, trendLoading,
}: {
  dash: DashboardCounts | undefined;
  isLoading: boolean;
  trend: DayPoint[];
  trendLoading: boolean;
}) {
  const t = useT();

  const delta = dash && dash.revenue_yesterday > 0
    ? Math.round(((dash.revenue_today - dash.revenue_yesterday) / dash.revenue_yesterday) * 100)
    : null;
  const trendUp = delta != null && delta >= 0;

  const counts = dash ? [
    { value: dash.refills_today,       label: t('dash.pulse.refills')  },
    { value: dash.new_customers_today, label: t('dash.pulse.new_cust') },
    { value: dash.msgs_out_today,      label: t('dash.pulse.msgs')     },
    { value: dash.reminders_due_today, label: t('dash.pulse.due'), attention: true },
  ] : [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('dash.pulse.revenue_today')}
            </span>
            {/* Live indicator as a small dot, not a chip — it is a status, not
                a headline. */}
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />
              {t('dash.pulse.live')}
            </span>
          </div>

          {isLoading || !dash ? (
            <Skeleton className="mt-2 h-11 w-44" />
          ) : (
            <>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-3">
                <span className="mono-num text-4xl font-semibold leading-none tracking-tight tabular-nums sm:text-[2.75rem]">
                  {formatINR(dash.revenue_today)}
                </span>
                {delta != null && (
                  <span className={cn(
                    'inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums',
                    trendUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                  )}>
                    {trendUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    {Math.abs(delta)}%
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('dash.pulse.vs_yesterday')}{' '}
                <span className="mono-num tabular-nums text-foreground">
                  {formatINR(dash.revenue_yesterday)}
                </span>
              </p>
            </>
          )}
        </div>

        <RevenueTrend days={trend} loading={trendLoading} />
      </div>

      {/* Today's counts — one divided strip of plain numbers. No icon chips:
          four coloured chips beside four coloured numerals was the noisiest
          part of the old layout and none of it aided the scan. */}
      <div className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-4 sm:divide-y-0">
        {isLoading || !dash
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-3.5">
                <Skeleton className="h-5 w-10" />
                <Skeleton className="mt-1.5 h-3 w-14" />
              </div>
            ))
          : counts.map((c) => (
              <div key={c.label} className="px-5 py-3.5">
                <div className={cn(
                  'mono-num text-lg font-semibold leading-none tabular-nums',
                  c.attention && c.value > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                )}>
                  {c.value}
                </div>
                <div className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.label}
                </div>
              </div>
            ))}
      </div>
    </Card>
  );
}

interface SaleRow { sold_at: string | null; bill_amount: number | null }
interface RefillRow { refilled_at: string | null; bill_amount: number | null }

/** Local-time YYYY-MM-DD bucket key. Uses local parts rather than
 *  toISOString() so a late-evening sale lands on the day the pharmacist
 *  actually made it, not the next UTC day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compact ₹ formatter — switches to "₹1.2k" / "₹1.5L" past thresholds. */
function formatINRCompact(amount: number): string {
  if (amount >= 100_000) return `₹${(amount / 100_000).toFixed(1)}L`;
  if (amount >= 1_000)   return `₹${(amount / 1_000).toFixed(1)}k`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
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

  // ── 7-day revenue trend ─────────────────────────────────────────────
  // Sales + refills, matching how crm_dashboard_counts computes revenue_today
  // (20260627_01:46-49) so the last bar always agrees with the hero figure.
  // Bounded to 7 days, so this stays a small read even for a busy counter.
  const { data: trend = [], isLoading: loadingTrend } = useQuery<DayPoint[]>({
    queryKey: ['revenue-7d', pharmacyId],
    enabled: !!pharmacyId,
    staleTime: 300_000,
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);

      const [sales, refills] = await Promise.all([
        supabase.from('crm_customer_sales')
          .select('sold_at, bill_amount')
          .eq('pharmacy_id', pharmacyId)
          .gte('sold_at', start.toISOString()),
        supabase.from('crm_prescription_refills')
          .select('refilled_at, bill_amount')
          .eq('pharmacy_id', pharmacyId)
          .gte('refilled_at', start.toISOString()),
      ]);
      if (sales.error) throw new Error(sales.error.message);
      if (refills.error) throw new Error(refills.error.message);

      // Seed all 7 buckets first so quiet days render as zero bars rather
      // than vanishing from the axis.
      const buckets = new Map<string, number>();
      const days: DayPoint[] = [];
      const todayKey = dayKey(new Date());
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const key = dayKey(d);
        buckets.set(key, 0);
        days.push({
          key,
          label: d.toLocaleDateString('en-IN', { weekday: 'short' }),
          total: 0,
          isToday: key === todayKey,
        });
      }

      const add = (iso: string | null, amount: number | null) => {
        if (!iso) return;
        const key = dayKey(new Date(iso));
        if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + (amount ?? 0));
      };
      for (const r of (sales.data ?? []) as unknown as SaleRow[]) add(r.sold_at, r.bill_amount);
      for (const r of (refills.data ?? []) as unknown as RefillRow[]) add(r.refilled_at, r.bill_amount);

      return days.map((d) => ({ ...d, total: buckets.get(d.key) ?? 0 }));
    },
  });

  // ── Realtime: invalidate dashboard on any relevant table change ──────
  useRealtimeInvalidate({ table: 'crm_customers',           pharmacyId, queryKeys: [['dashboard', pharmacyId], ['customers', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_scheduled_reminders', pharmacyId, queryKeys: [['dashboard', pharmacyId], ['upcoming-reminders', pharmacyId], ['due-reminders', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_customer_sales',      pharmacyId, queryKeys: [['dashboard', pharmacyId]] });
  useRealtimeInvalidate({ table: 'crm_prescription_refills',pharmacyId, queryKeys: [['dashboard', pharmacyId]] });

  interface UpcomingRow {
    id: string;
    scheduled_for: string;
    status: string;
    variables?: Record<string, string> | null;
    customer: { id: string; name: string; phone: string; whatsapp_opted_in: boolean };
    template: { name: string; body: string };
  }

  const { data: upcoming, isLoading: loadingReminders } = useQuery<UpcomingRow[]>({
    queryKey: ['upcoming-reminders', pharmacyId],
    enabled: !!pharmacyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_scheduled_reminders')
        .select(`
          id, scheduled_for, status, variables,
          customer:crm_customers!inner(id, name, phone, whatsapp_opted_in),
          template:crm_templates!inner(name, body)
        `)
        .eq('pharmacy_id', pharmacyId)
        .eq('status', 'pending')
        // No date filter: show ALL pending reminders (overdue + upcoming)
        .order('scheduled_for')
        .limit(8);
      if (error) throw error;
      return (data ?? []) as unknown as UpcomingRow[];
    },
  });

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
    qc.invalidateQueries({ queryKey: ['upcoming-reminders', pharmacyId] });
    qc.invalidateQueries({ queryKey: ['due-reminders', pharmacyId] });
    qc.invalidateQueries({ queryKey: ['dashboard-counts', pharmacyId] });
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

      {/* Hero: today's revenue + 7-day trend + today's counts */}
      <TodayPanel
        dash={counts}
        isLoading={loadingCounts}
        trend={trend}
        trendLoading={loadingTrend}
      />

      {/* ── Practice stats ──────────────────────────────────────────────
          Standing totals, not today's activity — deliberately one quiet card
          rather than four competing tiles. Only "pending reminders" can take
          colour, and only when it is non-zero, because it is the only one of
          the four that ever asks for action.
      ── */}
      <Card className="grid grid-cols-2 divide-x divide-y overflow-hidden md:grid-cols-4 md:divide-y-0">
        <StatCell
          label={t('dash.kpi.customers')}
          value={counts?.total_customers != null ? counts.total_customers.toLocaleString('en-IN') : '—'}
          sub={`+${counts?.this_week ?? 0} ${t('dash.this_week')}`}
          onClick={() => navigate('/customers')}
        />
        <StatCell
          label={t('dash.kpi.today_reminders')}
          value={counts?.today_pending ?? '—'}
          sub={`${counts?.today_sent ?? 0} ${t('dash.sent')} ${t('dash.today')}`}
          tone={counts && counts.today_pending > 0 ? 'attention' : 'default'}
          onClick={() => navigate('/reminders')}
        />
        <StatCell
          label={t('dash.kpi.visits_month')}
          value={counts?.visits_month != null ? counts.visits_month.toLocaleString('en-IN') : '—'}
          sub={t('dash.total_visits')}
          onClick={() => navigate('/activity')}
        />
        <StatCell
          label={t('dash.kpi.chronic')}
          value={counts?.chronic_count ?? '—'}
          sub={`${counts && counts.total_customers > 0 ? Math.round((counts.chronic_count / counts.total_customers) * 100) : 0}% ${t('dash.of_total')}`}
          onClick={() => navigate('/customers?segment=chronic')}
        />
      </Card>

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
                          new Date(row.scheduled_for) < endOfToday ? 'text-destructive font-semibold' : 'text-muted-foreground'
                        )}>
                          {new Date(row.scheduled_for).toLocaleString('en-IN', {
                            day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                          })}
                        </span>
                        {new Date(row.scheduled_for) < new Date() && (
                          <span className="rounded bg-destructive/10 px-1 py-px text-[9px] font-bold uppercase tracking-wider text-destructive">
                            overdue
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Quick WhatsApp send — only for reminders due today / overdue */}
                  {new Date(row.scheduled_for) < endOfToday && (
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
                  )}
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
