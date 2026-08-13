/**
 * Proactive top-5 reminders popup. Auto-opens when reminders are due, then
 * re-appears on a configurable cadence (Settings → Preferences → Reminder
 * pop-ups) after each dismiss — as long as reminders remain pending.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  BellRing, Loader2, Send, X as XIcon, Clock, BellOff, ChevronRight,
  CheckCircle2, AlertTriangle, Pill,
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
  // Honour the OS "reduce motion" setting: this dialog opens on its own,
  // unprompted, which is exactly the case that setting exists for.
  const reduceMotion = useReducedMotion();
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

      if (result.via === 'manual') {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            if (document.hasFocus()) {
              resolve();
            } else {
              const onFocus = () => {
                window.removeEventListener('focus', onFocus);
                resolve();
              };
              window.addEventListener('focus', onFocus);
            }
          }, 1000);
        });
      }

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
  const overdueCount = top.filter((r) => new Date(r.scheduled_for) < new Date()).length;
  const sendableCount = top.filter((r) => r.customer?.whatsapp_opted_in !== false).length;

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
            className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[3px]"
          />

          {/* Centring wrapper.
              Flexbox rather than left-1/2 + -translate-x-1/2: Framer Motion
              writes `transform` inline while animating scale/y, which
              overrides Tailwind's translate utility — so a transform-centred
              card drifts off-axis for the length of the animation and only
              snaps into place at the end. Flex centring leaves `transform`
              entirely to Motion.
              pointer-events-none lets clicks fall through to the backdrop. */}
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="today-popup-title"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.985 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              // Column flex + max-h keeps the header and footer pinned while
              // only the list scrolls, so a centred card can never outgrow the
              // viewport.
              className="pointer-events-auto flex max-h-[88vh] w-full max-w-[780px] flex-col overflow-hidden rounded-2xl border bg-card shadow-modal"
            >
              {/* ── Header ─────────────────────────────────────────────── */}
              <div className="shrink-0 border-b bg-gradient-to-b from-primary/[0.07] to-transparent px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
                    <BellRing className="h-[18px] w-[18px]" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h2 id="today-popup-title" className="text-base font-semibold tracking-tight sm:text-[17px]">
                      {t('popup.title')}
                    </h2>
                    {/* One quiet meta line instead of a row of pills — the counts
                        are context, not the point of the card. Only the overdue
                        figure takes colour, so it stays the single loud thing. */}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>{t('popup.stat_due').replace('{n}', String(top.length))}</span>
                      {overdueCount > 0 && (
                        <>
                          <span aria-hidden="true" className="text-muted-foreground/40">·</span>
                          <span className="font-semibold text-destructive">
                            {t('popup.stat_overdue').replace('{n}', String(overdueCount))}
                          </span>
                        </>
                      )}
                      {overflow > 0 && (
                        <>
                          <span aria-hidden="true" className="text-muted-foreground/40">·</span>
                          {/* Bare "+N" rather than popup.plus_more — that string
                              is parenthesised prose written for the old subtitle
                              and reads badly in a dot-separated list. */}
                          <span className="font-mono">+{overflow}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => close()}
                    aria-label={t('popup.close')}
                    className="-mr-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>

                {canSend === false && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {t('bell.cant_send_now')}
                  </div>
                )}
              </div>

              {/* ── Body ───────────────────────────────────────────────── */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {top.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold">{t('popup.empty')}</p>
                    <p className="text-xs text-muted-foreground">{t('bell.empty_hint')}</p>
                  </div>
                ) : (
                  <ul className="divide-y">
                    {top.map((r, i) => (
                      <PopupRow
                        key={r.id}
                        index={i}
                        reduceMotion={!!reduceMotion}
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

              {/* ── Queue progress (in-card) ───────────────────────────── */}
              {queue && queue.length > 0 && (
                <div className="shrink-0 border-t bg-primary/5 px-5 py-3.5 sm:px-6">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                      {t('bell.queue_status').replace('{n}', String(queue.length))}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {top.length - queue.length + 1} / {top.length}
                    </span>
                  </div>
                  {/* Progress bar makes a multi-send run feel finite. */}
                  <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${((top.length - queue.length) / Math.max(top.length, 1)) * 100}%` }}
                    />
                  </div>
                  <div className="mb-2.5 text-xs">
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
                      className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {queue.length === 1 ? t('bell.queue_done') : t('bell.queue_next')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setQueue(null)}
                      disabled={send.isPending}
                      className="rounded-lg border border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
                    >
                      {t('bell.queue_stop')}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Footer ─────────────────────────────────────────────── */}
              {!queue && top.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-muted/30 px-5 py-3.5 sm:px-6">
                  <Link
                    to="/reminders"
                    onClick={() => close()}
                    className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
                  >
                    {t('bell.view_all')} <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                  <div className="flex flex-1 justify-end gap-2 sm:flex-none">
                    <button
                      type="button"
                      onClick={() => close()}
                      className="rounded-lg border border-input bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
                    >
                      {t('popup.dismiss')}
                    </button>
                    {top.length > 1 && canSend !== false && sendableCount > 0 && (
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
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t('bell.start_queue').replace('{n}', String(sendableCount))}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────────

function PopupRow({
  reminder, onSend, onSkip, sending, skipping, canSend, index, reduceMotion,
}: {
  reminder: DueReminder;
  onSend: () => void;
  onSkip: () => void;
  sending: boolean;
  skipping: boolean;
  canSend: boolean;
  index: number;
  reduceMotion: boolean;
}) {
  const t = useT();
  const optedOut = reminder.customer?.whatsapp_opted_in === false;
  const overdue = new Date(reminder.scheduled_for) < new Date();
  const medicine = (reminder.variables?.['medicine'] as string | undefined) ?? '';
  const time = new Date(reminder.scheduled_for).toLocaleString('en-IN', {
    hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short',
  });

  const blocked = optedOut || !canSend;
  const blockedReason = optedOut
    ? t('bell.tooltip_optout')
    : !canSend ? t('bell.tooltip_rate_limited') : undefined;

  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduceMotion ? 0 : index * 0.04, duration: 0.18 }}
      className={cn(
        'relative px-5 py-3.5 transition-colors hover:bg-muted/30 sm:px-6',
        // Inset, rounded rail rather than a full-bleed bar — reads as an
        // accent on the row instead of a divider between rows.
        overdue &&
          'before:absolute before:inset-y-2.5 before:left-2 before:w-[2px] before:rounded-full before:bg-destructive/70'
      )}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <div className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          overdue
            ? 'bg-destructive/10 text-destructive'
            : 'bg-primary/10 text-primary'
        )}>
          {reminder.customer ? initials(reminder.customer.name) : '?'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              to={`/customers/${reminder.customer?.id}`}
              className="truncate text-sm font-semibold hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {reminder.customer?.name ?? t('bell.unknown_customer')}
            </Link>

            {/* Timestamp as plain meta text, not a chip. Only states that need
                attention (overdue, opted out) get a filled background, so the
                row has one visual emphasis at most. */}
            <span className={cn(
              'inline-flex items-center gap-1 font-mono text-[10px]',
              overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'
            )}>
              <Clock className="h-2.5 w-2.5" />
              {time}
            </span>

            {medicine && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <Pill className="h-2.5 w-2.5" />
                {medicine}
              </span>
            )}

            {optedOut && (
              <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-destructive">
                <BellOff className="h-2.5 w-2.5" />
                {t('bell.opted_out')}
              </span>
            )}
          </div>

          <p
            lang={reminder.template?.language ?? 'en'}
            className={cn(
              'mt-1 line-clamp-2 text-xs leading-[1.55] text-muted-foreground',
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
        </div>

        {/* Actions — beside the text on desktop, stacked under it on phones.
            Fixed width so the Send buttons form a clean column down the card
            and don't jitter when the label swaps to "Sending…". */}
        <div className="flex shrink-0 gap-2 pl-11 sm:pl-0">
          <button
            type="button"
            onClick={onSend}
            disabled={sending || skipping || blocked}
            title={blockedReason}
            className="inline-flex h-8 w-[86px] items-center justify-center gap-1.5 rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <><Send className="h-3.5 w-3.5" />{t('bell.send')}</>}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={sending || skipping}
            aria-label={t('bell.skip')}
            title={t('bell.skip')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          >
            {skipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XIcon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </motion.li>
  );
}
