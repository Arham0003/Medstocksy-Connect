/**
 * Proactive top-5 reminders popup. Auto-opens when reminders are due, then
 * re-appears on a configurable cadence (Settings → Preferences → Reminder
 * pop-ups) after each dismiss — as long as reminders remain pending.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BellRing, Loader2, Send, X as XIcon, Clock, BellOff, ChevronRight,
} from 'lucide-react';
import { useActivePharmacy, usePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import {
  listDueReminders, markReminderSent, cancelReminder, renderReminderMessage, type DueReminder,
} from '@/lib/api/reminders';
import { canSendNow, sendOrCompose, logManualSend } from '@/lib/api/messages';
import { getSnoozedUntil, snoozePopup } from '@/lib/notify';
import { cn, initials, renderTemplate } from '@/lib/utils';

const TOP_N = 5;

export function TodayRemindersPopup() {
  const { activePharmacyId } = usePharmacy();
  if (!activePharmacyId) return null;
  return <TodayRemindersPopupInner />;
}

function TodayRemindersPopupInner() {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<DueReminder[] | null>(null);
  // Bumps every 30s to re-evaluate the snooze window without a full refetch.
  const [tick, setTick] = useState(0);

  const { data: reminders = [], isLoading } = useQuery<DueReminder[]>({
    queryKey: ['due-reminders', pharmacyId],
    queryFn: () => listDueReminders(pharmacyId),
    enabled: !!pharmacyId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: canSend } = useQuery({
    queryKey: ['can-send-now', pharmacyId],
    queryFn: () => canSendNow(pharmacyId),
    enabled: !!pharmacyId,
    staleTime: 30_000,
  });

  // Heartbeat: re-check the snooze window every 30s so the popup re-appears
  // once the configured interval has elapsed.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Open whenever: there are pending reminders AND the snooze window has passed
  // AND it's not already open. Re-evaluated on data change + every heartbeat.
  useEffect(() => {
    if (isLoading || open) return;
    if (reminders.length === 0) return;
    if (Date.now() < getSnoozedUntil()) return;
    setOpen(true);
  }, [isLoading, reminders.length, open, tick]);

  const close = (markSnoozed = true) => {
    if (markSnoozed) snoozePopup();
    setOpen(false);
    setQueue(null);
  };

  const send = useMutation<void, Error, DueReminder>({
    mutationFn: async (r) => {
      if (!r.template || !r.customer) throw new Error('Reminder missing template or customer.');
      if (!r.customer.whatsapp_opted_in) throw new Error('Customer is opted out of WhatsApp.');

      const body = await renderReminderMessage({
        body: r.template.body,
        customerName: r.customer.name,
        customerPhone: r.customer.phone,
        storedVars: r.variables,
        pharmacyId,
      });

      const result = await sendOrCompose({ phone: r.customer.phone, body });

      const { messageId } = await logManualSend({
        pharmacyId,
        customerId: r.customer.id,
        phone: r.customer.phone,
        body,
        templateId: r.template.id,
      });

      await markReminderSent(r.id, result.messageId ?? messageId);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['due-reminders', pharmacyId] });
      await qc.invalidateQueries({ queryKey: ['whatsapp-health', pharmacyId] });
      await qc.invalidateQueries({ queryKey: ['dashboard-counts', pharmacyId] });
    },
  });

  const skip = useMutation<void, Error, DueReminder>({
    mutationFn: (r) => cancelReminder(r.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['due-reminders', pharmacyId] });
      await qc.invalidateQueries({ queryKey: ['dashboard-counts', pharmacyId] });
    },
  });

  // Pre-slice once so render + queue logic agree on the same 5 rows.
  const top = reminders.slice(0, TOP_N);
  const overflow = Math.max(0, reminders.length - TOP_N);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => close()}
            className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]"
          />

          {/* Card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="today-popup-title"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-2rem)] max-w-[460px] -translate-x-1/2 overflow-hidden rounded-2xl border bg-card shadow-modal"
          >
            {/* Header */}
            <div className="relative flex items-start gap-3 border-b bg-gradient-to-br from-primary/10 via-transparent to-transparent px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <BellRing className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="today-popup-title" className="text-base font-bold tracking-tight">
                  {t('popup.title')}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('popup.subtitle')
                    .replace('{n}', String(top.length))
                    .replace('{extra}', overflow > 0 ? t('popup.plus_more').replace('{n}', String(overflow)) : '')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => close()}
                aria-label={t('popup.close')}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[60vh] overflow-y-auto">
              {top.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  {t('popup.empty')}
                </div>
              ) : (
                <ul className="divide-y">
                  {top.map((r) => (
                    <PopupRow
                      key={r.id}
                      reminder={r}
                      onSend={() => send.mutate(r)}
                      onSkip={() => skip.mutate(r)}
                      sending={send.isPending && send.variables?.id === r.id}
                      skipping={skip.isPending && skip.variables?.id === r.id}
                      canSend={canSend !== false}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Queue progress (in-card) */}
            {queue && queue.length > 0 && (
              <div className="border-t bg-primary/5 px-5 py-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  {t('bell.queue_status').replace('{n}', String(queue.length))}
                </div>
                <div className="mb-2 text-xs">
                  {send.isPending
                    ? t('bell.queue_opening').replace('{name}', queue[0]?.customer?.name ?? '—')
                    : t('bell.queue_waiting').replace('{name}', queue[0]?.customer?.name ?? '—')}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const remaining = queue.slice(1);
                      const next = remaining[0];
                      if (!next) {
                        setQueue(null);
                      } else {
                        setQueue(remaining);
                        send.mutate(next);
                      }
                    }}
                    disabled={send.isPending}
                    className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    {queue.length === 1 ? t('bell.queue_done') : t('bell.queue_next')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQueue(null)}
                    disabled={send.isPending}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-60"
                  >
                    {t('bell.queue_stop')}
                  </button>
                </div>
              </div>
            )}

            {/* Footer actions — only when no queue is in flight */}
            {!queue && top.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-5 py-3">
                <Link
                  to="/reminders"
                  onClick={() => close()}
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                >
                  {t('bell.view_all')} <ChevronRight className="h-3 w-3" />
                </Link>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => close()}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40"
                  >
                    {t('popup.dismiss')}
                  </button>
                  {top.length > 1 && canSend !== false && (
                    <button
                      type="button"
                      onClick={() => {
                        const eligible = top.filter((r) => r.customer?.whatsapp_opted_in !== false);
                        const first = eligible[0];
                        if (!first) return;
                        setQueue(eligible);
                        send.mutate(first);
                      }}
                      disabled={send.isPending}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                    >
                      {t('bell.start_queue').replace('{n}', String(
                        top.filter((r) => r.customer?.whatsapp_opted_in !== false).length
                      ))}
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

function PopupRow({
  reminder, onSend, onSkip, sending, skipping, canSend,
}: {
  reminder: DueReminder;
  onSend: () => void;
  onSkip: () => void;
  sending: boolean;
  skipping: boolean;
  canSend: boolean;
}) {
  const t = useT();
  const optedOut = reminder.customer?.whatsapp_opted_in === false;
  const overdue = new Date(reminder.scheduled_for) < new Date();
  const time = new Date(reminder.scheduled_for).toLocaleString('en-IN', {
    hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short',
  });

  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {reminder.customer ? initials(reminder.customer.name) : '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link
              to={`/customers/${reminder.customer?.id}`}
              className="truncate text-sm font-semibold hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {reminder.customer?.name ?? t('bell.unknown_customer')}
            </Link>
            <span className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] font-mono',
              overdue ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
            )}>
              <Clock className="h-2.5 w-2.5" />
              {time}
            </span>
          </div>
          <p
            lang={reminder.template?.language ?? 'en'}
            className={cn(
              'mt-0.5 line-clamp-2 text-[12px] text-muted-foreground',
              reminder.template?.language === 'hi' && 'font-["Noto_Sans_Devanagari",Inter,system-ui]'
            )}
          >
            {reminder.template
              ? renderTemplate(reminder.template.body, {
                  name: reminder.customer?.name ?? '',
                  ...(reminder.variables ?? {}),
                }).replace(/\{\w+\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
              : ''}
          </p>

          {optedOut && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
              <BellOff className="h-2.5 w-2.5" />
              {t('bell.opted_out')}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onSend}
              disabled={sending || skipping || optedOut || !canSend}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {sending ? t('bell.sending') : t('bell.send')}
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={sending || skipping}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              {skipping ? <Loader2 className="h-3 w-3 animate-spin" /> : <XIcon className="h-3 w-3" />}
              {skipping ? '…' : t('bell.skip')}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

