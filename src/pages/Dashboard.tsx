import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { BellRing, Megaphone, Send, Users, Activity as ActivityIcon, HeartPulse, ClipboardList, AlertTriangle, FileText, Zap, MessageSquare, Smartphone, PhoneCall, IndianRupee, ArrowUpRight, ArrowDownRight, UserPlus, RefreshCcw, Clock } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase } from '@/lib/supabase';
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

/**
 * Compact stat tile: icon chip + label + value + subtitle on a tight rhythm.
 * Optional accent color tints the value (orange/coral) for at-a-glance scanning.
 */
interface StatTileProps {
  label: string;
  value: string | number;
  sub: string;
  icon: typeof BellRing;
  /** Brand semantics — used for the icon chip background and the value tint when valueColor is set. */
  dotColor: string;
  /** Tint the value itself (orange today-reminders + coral chronic) */
  valueColor?: string;
  delay?: number;
}

function StatTile({
  label, value, sub, icon: Icon, dotColor, valueColor, delay = 0, onClick, href,
}: StatTileProps & { onClick?: () => void; href?: string }) {
  const interactive = !!(onClick || href);
  const Wrapper = interactive ? 'button' : 'div';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay }}
    >
      <Wrapper
        onClick={onClick}
        type={interactive ? 'button' : undefined}
        className={cn(
          // KarigarCred-style: left-color-accent bar + white card + clean shadow
          'group flex w-full items-center gap-3.5 rounded-xl border-l-4 bg-card px-4 py-3.5 text-left card-elev transition-all',
          'rounded-l-none rounded-r-xl', // left side is flat for the accent bar
          interactive &&
            'cursor-pointer hover:-translate-y-0.5 hover:shadow-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        )}
        style={{ borderLeftColor: dotColor }}
      >
        {/* Icon chip — 48px for pre-attentive scan affordance */}
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: `${dotColor}15`,
            color: dotColor,
          }}
          aria-hidden
        >
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          {/* Label — small-caps, muted, reads as category not value */}
          <div className="truncate text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title={label}>
            {label}
          </div>
          {/* Value — JetBrains Mono for data (Cognitive Load Theory: distinct visual channels) */}
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn(
                'mono-num truncate text-[28px] font-bold leading-none',
                !valueColor && 'text-foreground'
              )}
              style={valueColor ? { color: valueColor } : undefined}
            >
              {value ?? '—'}
            </span>
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</div>
        </div>

        {/* Arrow hint on interactive tiles */}
        {interactive && (
          <span className="shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/70">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </span>
        )}
      </Wrapper>
    </motion.div>
  );
}

// Updated palette — more vibrant, better contrast against white cards
const TILE_COLORS = {
  greenDot:  '#0D9488',  // teal-600 — trust + health
  orangeDot: '#D97706',  // amber-600 — urgency + attention
  purpleDot: '#7C3AED',  // violet-600 — analytics
  coralDot:  '#DC2626',  // red-600 — chronic / alerts
} as const;

/* ─── Today's Pulse widget — driven by unified dashboard RPC ─────────── */
function TodaysPulse({
  pharmacyId,
  dash,
  isLoading,
}: {
  pharmacyId: string;
  dash: DashboardCounts | undefined;
  isLoading: boolean;
}) {
  const t = useT();

  const data = dash ? {
    revenueToday:      dash.revenue_today,
    revenueYesterday:  dash.revenue_yesterday,
    refillsToday:      dash.refills_today,
    newCustomersToday: dash.new_customers_today,
    messagesSentToday: dash.msgs_out_today,
    remindersDueToday: dash.reminders_due_today,
  } : undefined;

  const delta = data && data.revenueYesterday > 0
    ? Math.round(((data.revenueToday - data.revenueYesterday) / data.revenueYesterday) * 100)
    : null;
  const trendUp = delta != null && delta >= 0;

  // pharmacyId unused here but kept for component interface consistency
  void pharmacyId;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Zap className="h-4 w-4 text-primary" />
          {t('dash.pulse.title')}
        </h2>
        <span className="text-[11px] text-muted-foreground">{t('dash.pulse.live')}</span>
      </div>

      {isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Revenue today + delta vs yesterday */}
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <IndianRupee className="h-3 w-3" />
              {t('dash.pulse.revenue_today')}
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono">
              <span className="text-3xl font-bold tabular-nums">
                {formatINRCompact(data.revenueToday)}
              </span>
              {delta != null && (
                <span className={cn(
                  'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                  trendUp
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-destructive/10 text-destructive'
                )}>
                  {trendUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(delta)}%
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {t('dash.pulse.vs_yesterday')} {formatINRCompact(data.revenueYesterday)}
            </div>
          </div>

          {/* 4-stat grid */}
          <div className="grid grid-cols-2 gap-2 border-t pt-4 sm:grid-cols-4">
            <PulseStat icon={<RefreshCcw className="h-3.5 w-3.5" />} value={data.refillsToday}      label={t('dash.pulse.refills')} tone="emerald" />
            <PulseStat icon={<UserPlus className="h-3.5 w-3.5" />}   value={data.newCustomersToday} label={t('dash.pulse.new_cust')} tone="primary" />
            <PulseStat icon={<Send className="h-3.5 w-3.5" />}       value={data.messagesSentToday} label={t('dash.pulse.msgs')}    tone="sky" />
            <PulseStat icon={<Clock className="h-3.5 w-3.5" />}      value={data.remindersDueToday} label={t('dash.pulse.due')}     tone="amber" />
          </div>
        </div>
      )}
    </Card>
  );
}

function PulseStat({
  icon, value, label, tone,
}: {
  icon: React.ReactNode; value: number; label: string;
  tone: 'primary' | 'emerald' | 'sky' | 'amber';
}) {
  const colorMap: Record<typeof tone, { chip: string; val: string }> = {
    primary: { chip: 'bg-primary/10 text-primary',                               val: 'hsl(226 71% 45%)' },
    emerald: { chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', val: '#059669' },
    sky:     { chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',             val: '#0284C7' },
    amber:   { chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',       val: '#B45309' },
  };
  const { chip, val } = colorMap[tone];
  return (
    <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg border bg-card/60 p-3">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', chip)}>
        {icon}
      </span>
      <div className="min-w-0 max-w-full">
        {/* JetBrains Mono for pulse stats — same visual channel as KPI tiles */}
        <div className="mono-num truncate text-xl font-bold leading-none" style={{ color: val }}>{value}</div>
        <div className="mt-0.5 truncate text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground" title={label}>{label}</div>
      </div>
    </div>
  );
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
          <FileText className="h-4 w-4 text-primary" /> Recent Prescriptions
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
          <AlertTriangle className="h-4 w-4 text-red-500" /> Failed Reminders
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
            <div className="flex justify-center mb-2">
              <Zap className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">All reminders delivered!</div>
            <div className="text-xs text-muted-foreground mt-1">No failures to report.</div>
          </div>
        ) : failed.map(r => (
          <button key={r.id} onClick={() => r.customer && onNavigate(`/customers/${r.customer.id}`)}
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30">
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
      const { data, error } = await (supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
      }).rpc('crm_dashboard_counts', { p_pharmacy_id: pharmacyId });
      if (error) throw new Error(error.message);
      return data as DashboardCounts;
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
    variables?: Record<string, any> | null;
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

      {/* ── KPI tiles ───────────────────────────────────────────────────
          Left-accent border pattern (KarigarCred-inspired)
          2-up on phones → 4-up on desktop (pre-attentive color + number scan)
      ── */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label={t('dash.kpi.customers')}
          value={counts?.total_customers != null ? counts.total_customers.toLocaleString() : '—'}
          sub={`+${counts?.this_week ?? 0} ${t('dash.this_week')}`}
          icon={Users}
          dotColor={TILE_COLORS.greenDot}
          onClick={() => navigate('/customers')}
          delay={0}
        />
        <StatTile
          label={t('dash.kpi.today_reminders')}
          value={counts ? (counts.today_pending + counts.today_sent) : '—'}
          sub={`${counts?.today_sent ?? 0} ${t('dash.sent')} · ${counts?.today_pending ?? 0} ${t('dash.pending')}`}
          icon={BellRing}
          dotColor={TILE_COLORS.orangeDot}
          valueColor={TILE_COLORS.orangeDot}
          onClick={() => navigate('/reminders')}
          delay={0.04}
        />
        <StatTile
          label={t('dash.kpi.visits_month')}
          value={counts?.visits_month != null ? counts.visits_month.toLocaleString() : '—'}
          sub={t('dash.total_visits')}
          icon={ActivityIcon}
          dotColor={TILE_COLORS.purpleDot}
          onClick={() => navigate('/activity')}
          delay={0.08}
        />
        <StatTile
          label={t('dash.kpi.chronic')}
          value={counts?.chronic_count ?? '—'}
          sub={`${counts && counts.total_customers > 0 ? Math.round((counts.chronic_count / counts.total_customers) * 100) : 0}% ${t('dash.of_total')}`}
          icon={HeartPulse}
          dotColor={TILE_COLORS.coralDot}
          valueColor={TILE_COLORS.coralDot}
          onClick={() => navigate('/customers?segment=chronic')}
          delay={0.12}
        />
      </section>

      {/* Two-col: upcoming + health — on tablets and up side by side */}
      <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
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
              upcoming.map((row) => (
                <div
                  key={row.id}
                  className="flex w-full items-center gap-3 p-4 transition-colors hover:bg-muted/40"
                >
                  <button
                    onClick={() => navigate(`/customers/${row.customer.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      {row.variables?.channel === 'whatsapp' ? <MessageSquare className="h-4 w-4 text-emerald-600" />
                        : row.variables?.channel === 'sms' ? <Smartphone className="h-4 w-4 text-blue-600" />
                        : row.variables?.channel === 'call' ? <PhoneCall className="h-4 w-4 text-amber-600" />
                        : <BellRing className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{row.customer.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.variables?.medicine || 'Reminder'} · {row.template.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {new Date(row.scheduled_for).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                        })}
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
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
                        row.customer.whatsapp_opted_in
                          ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'
                          : 'cursor-not-allowed bg-muted text-muted-foreground/50'
                      )}
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">{t('dash.upcoming.empty')}</div>
            )}
          </div>
        </Card>

        <TodaysPulse pharmacyId={pharmacyId} dash={counts} isLoading={loadingCounts} />
      </div>

      {/* Bottom row: recent prescriptions + failed reminders */}
      <div className="grid gap-4 md:grid-cols-2">
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
