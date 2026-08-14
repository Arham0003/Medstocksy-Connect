/**
 * Post-send campaign report.
 *
 * Stats are computed from `crm_campaign_recipients` rather than read off the
 * denormalised counters on `crm_campaigns` (sent_count / delivered_count /
 * reply_count). Those counters are only written by the send path, so a
 * campaign that was interrupted — or whose delivery receipts arrived later
 * via the webhook — leaves them behind the real per-recipient rows. The
 * recipient table is the source of truth.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCheck, Send, Eye, XCircle, Clock, MessageSquare } from 'lucide-react';
import { supabase, type Tables } from '@/lib/supabase';
import { useT } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

type Campaign = Tables<'crm_campaigns'>;

/** Mirrors the crm_message_status enum (20260507_medcrm.sql:21). */
type RecipientStatus =
  | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'bounced';

interface RecipientRow {
  id: string;
  status: RecipientStatus;
  sent_at: string | null;
  customer: { id: string; name: string; phone: string } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
}

/** Statuses that mean the message at least left the building. `read` implies
 *  `delivered` implies `sent`, so the funnel counts them cumulatively. */
const REACHED: RecipientStatus[] = ['sent', 'delivered', 'read'];
const DELIVERED: RecipientStatus[] = ['delivered', 'read'];

const STATUS_STYLE: Record<RecipientStatus, string> = {
  queued:    'bg-muted text-muted-foreground',
  sending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  sent:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  read:      'bg-emerald-200 text-emerald-900 dark:bg-emerald-800/40 dark:text-emerald-200',
  failed:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  bounced:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export function CampaignAnalyticsDialog({ open, onOpenChange, campaign }: Props) {
  const t = useT();

  const { data: recipients, isLoading } = useQuery<RecipientRow[]>({
    queryKey: ['campaign-recipients', campaign?.id],
    enabled: open && !!campaign?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_campaign_recipients')
        .select('id, status, sent_at, customer:crm_customers(id, name, phone)')
        .eq('campaign_id', campaign!.id)
        .order('sent_at', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as RecipientRow[];
    },
  });

  // Inbound replies can't be derived from the recipient table — they live in
  // crm_messages. Counted distinctly so one chatty patient isn't a 300% rate.
  const { data: replyCount = 0 } = useQuery<number>({
    queryKey: ['campaign-replies', campaign?.id],
    enabled: open && !!campaign?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_messages')
        .select('customer_id')
        .eq('campaign_id', campaign!.id)
        .eq('direction', 'inbound');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as { customer_id: string }[];
      return new Set(rows.map((r) => r.customer_id)).size;
    },
  });

  const stats = useMemo(() => {
    const rows = recipients ?? [];
    const total = rows.length;
    const reached = rows.filter((r) => REACHED.includes(r.status)).length;
    const delivered = rows.filter((r) => DELIVERED.includes(r.status)).length;
    const read = rows.filter((r) => r.status === 'read').length;
    const failed = rows.filter((r) => r.status === 'failed' || r.status === 'bounced').length;
    const pending = rows.filter((r) => r.status === 'queued' || r.status === 'sending').length;

    // Rates are share-of-attempted, not share-of-total: a campaign still
    // sending shouldn't report a collapsing delivery rate just because rows
    // are still queued.
    const pct = (n: number) => (reached > 0 ? Math.round((n / reached) * 100) : 0);

    return {
      total, reached, delivered, read, failed, pending,
      deliveredPct: pct(delivered),
      readPct: pct(read),
      replyPct: pct(replyCount),
    };
  }, [recipients, replyCount]);

  if (!campaign) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{campaign.name}</DialogTitle>
          <DialogDescription>{t('campaigns.analytics.desc')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : stats.total === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('campaigns.analytics.empty')}
          </p>
        ) : (
          <div className="space-y-5">
            {/* Headline rates */}
            <div className="grid grid-cols-3 gap-3">
              <RateTile
                label={t('campaigns.analytics.delivered_rate')}
                value={`${stats.deliveredPct}%`}
                sub={`${stats.delivered} / ${stats.reached}`}
                tone="emerald"
              />
              <RateTile
                label={t('campaigns.analytics.read_rate')}
                value={`${stats.readPct}%`}
                sub={`${stats.read} / ${stats.reached}`}
                tone="blue"
              />
              <RateTile
                label={t('campaigns.analytics.reply_rate')}
                value={`${stats.replyPct}%`}
                sub={`${replyCount} / ${stats.reached}`}
                tone="violet"
              />
            </div>

            {/* Funnel */}
            <div className="space-y-2">
              <FunnelBar icon={<Send className="h-3.5 w-3.5" />}      label={t('campaigns.analytics.step_sent')}      count={stats.reached}   total={stats.total} tone="bg-blue-500" />
              <FunnelBar icon={<CheckCheck className="h-3.5 w-3.5" />} label={t('campaigns.analytics.step_delivered')} count={stats.delivered} total={stats.total} tone="bg-emerald-500" />
              <FunnelBar icon={<Eye className="h-3.5 w-3.5" />}        label={t('campaigns.analytics.step_read')}      count={stats.read}      total={stats.total} tone="bg-emerald-600" />
              <FunnelBar icon={<MessageSquare className="h-3.5 w-3.5" />} label={t('campaigns.analytics.step_replied')} count={replyCount}   total={stats.total} tone="bg-violet-500" />
              {stats.failed > 0 && (
                <FunnelBar icon={<XCircle className="h-3.5 w-3.5" />}  label={t('campaigns.analytics.step_failed')}    count={stats.failed}    total={stats.total} tone="bg-red-500" />
              )}
              {stats.pending > 0 && (
                <FunnelBar icon={<Clock className="h-3.5 w-3.5" />}    label={t('campaigns.analytics.step_pending')}   count={stats.pending}   total={stats.total} tone="bg-amber-500" />
              )}
            </div>

            {/* Per-recipient */}
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('campaigns.analytics.recipients')} ({stats.total})
              </h4>
              <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
                {(recipients ?? []).map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.customer?.name ?? '—'}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {r.customer?.phone ?? ''}
                      </div>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                      STATUS_STYLE[r.status]
                    )}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const TONE_TEXT = {
  emerald: 'text-emerald-600',
  blue: 'text-blue-600',
  violet: 'text-violet-600',
} as const;

function RateTile({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone: keyof typeof TONE_TEXT;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-1 font-mono text-2xl font-bold', TONE_TEXT[tone])}>{value}</div>
      <div className="font-mono text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function FunnelBar({ icon, label, count, total, tone }: {
  icon: React.ReactNode; label: string; count: number; total: number; tone: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-32 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon} {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-xs font-semibold">
        {count} <span className="text-muted-foreground">({pct}%)</span>
      </span>
    </div>
  );
}
