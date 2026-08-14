/**
 * "Send all today" — walks the pending-reminder queue one recipient at a time.
 *
 * Why a queue and not a real batch: the free click-to-chat flow needs a user
 * gesture per recipient and hands the tab to WhatsApp, so N reminders cannot
 * be fired at once (the browser would block all but the first popup, and the
 * staff member still has to press send in WhatsApp each time). What this does
 * instead is remove the per-row hunting: open → return → auto-advance.
 *
 * `openWhatsAppCompose` reuses one named tab, so the whole run stays in a
 * single WhatsApp tab rather than opening dozens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, SkipForward, CheckCircle2, Loader2, AlertTriangle, BanIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { openWhatsAppCompose, logManualSend } from '@/lib/api/messages';
import { renderTemplate, cn } from '@/lib/utils';
import { useT } from '@/contexts/LanguageContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface BulkReminder {
  id: string;
  variables: Record<string, string>;
  customer: { id: string; name: string; phone: string; whatsapp_opted_in?: boolean } | null;
  template: { name: string; body?: string } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pharmacyId: string;
  reminders: BulkReminder[];
}

type Outcome = 'sent' | 'skipped' | 'failed';

export function BulkReminderSendDialog({ open, onOpenChange, pharmacyId, reminders }: Props) {
  const t = useT();
  const qc = useQueryClient();

  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only whatsapp-channel reminders with a phone can go through this flow.
  // Opted-out customers are excluded outright — sending to them is the one
  // failure mode here with legal consequences, so it is filtered rather than
  // left to the operator to notice.
  const queue = reminders.filter(
    (r) =>
      r.customer?.phone &&
      r.customer.whatsapp_opted_in !== false &&
      ((r.variables?.channel as string) ?? 'whatsapp') === 'whatsapp'
  );
  const excluded = reminders.length - queue.length;

  const current = queue[index];
  const done = index >= queue.length;

  useEffect(() => {
    if (open) {
      setIndex(0);
      setOutcomes({});
      setRunning(false);
      setAwaitingReturn(false);
      setError(null);
    }
  }, [open]);

  const markSent = useMutation<void, Error, { reminder: BulkReminder; body: string }>({
    mutationFn: async ({ reminder, body }) => {
      const { error: updErr } = await supabase
        .from('crm_scheduled_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() } as never)
        .eq('id', reminder.id);
      if (updErr) throw new Error(updErr.message);

      // Record it so the activity log, dashboard counters and the hourly
      // rate-limit window all see this send. The per-row Send button on
      // Reminders skips this, which is why manual sends never showed up in
      // crm_messages.
      if (reminder.customer) {
        await logManualSend({
          pharmacyId,
          customerId: reminder.customer.id,
          phone: reminder.customer.phone,
          body,
        });
      }
    },
    onSuccess: () => {
      for (const key of [
        'scheduled-reminders', 'reminders-today', 'reminders-overdue',
        'due-reminders', 'dashboard-counts', 'messages',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const advance = useCallback(() => {
    setAwaitingReturn(false);
    setIndex((i) => i + 1);
  }, []);

  // After the WhatsApp tab takes over, the app window blurs. When focus comes
  // back we treat that as "this one is handled" and move on. Same detection
  // the single-row Send button uses, hoisted so it works across the queue.
  const waitForReturn = useCallback(() => {
    setAwaitingReturn(true);
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      advance();
    };
    window.addEventListener('focus', onFocus);
  }, [advance]);

  const returnHandlerRef = useRef(waitForReturn);
  returnHandlerRef.current = waitForReturn;

  const sendCurrent = useCallback(async () => {
    if (!current?.customer) return;
    setError(null);

    const body = current.template?.body
      ? renderTemplate(current.template.body, current.variables)
      : '';

    const opened = openWhatsAppCompose({ phone: current.customer.phone, body });
    if (!opened) {
      setError(t('rem.bulk.popup_blocked'));
      setOutcomes((o) => ({ ...o, [current.id]: 'failed' }));
      return;
    }

    try {
      await markSent.mutateAsync({ reminder: current, body });
      setOutcomes((o) => ({ ...o, [current.id]: 'sent' }));
    } catch (e) {
      setOutcomes((o) => ({ ...o, [current.id]: 'failed' }));
      setError(e instanceof Error ? e.message : 'Failed to record send.');
    }
    returnHandlerRef.current();
  }, [current, markSent, t]);

  const skipCurrent = () => {
    if (!current) return;
    setOutcomes((o) => ({ ...o, [current.id]: 'skipped' }));
    advance();
  };

  const start = () => {
    setRunning(true);
    void sendCurrent();
  };

  const sentCount = Object.values(outcomes).filter((o) => o === 'sent').length;
  const skippedCount = Object.values(outcomes).filter((o) => o === 'skipped').length;
  const progress = queue.length ? Math.round(((index) / queue.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('rem.bulk.title')}</DialogTitle>
          <DialogDescription>
            {queue.length > 0
              ? t('rem.bulk.desc')
              : t('rem.bulk.nothing')}
          </DialogDescription>
        </DialogHeader>

        {excluded > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <BanIcon aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{t('rem.bulk.excluded').replace('{n}', String(excluded))}</span>
          </div>
        )}

        {queue.length > 0 && (
          <div className="space-y-4">
            {/* Progress */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">
                  {Math.min(index, queue.length)} / {queue.length}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-emerald-600">{sentCount} {t('rem.bulk.sent')}</span>
                  {skippedCount > 0 && (
                    <span className="text-muted-foreground">{skippedCount} {t('rem.bulk.skipped')}</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Current recipient */}
            {!done && current && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-sm font-semibold">{current.customer?.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {current.customer?.phone}
                  {current.variables?.medicine ? ` · ${current.variables.medicine}` : ''}
                </div>
                {current.template?.body && (
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                    {renderTemplate(current.template.body, current.variables)}
                  </p>
                )}
              </div>
            )}

            {done && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {t('rem.bulk.complete').replace('{n}', String(sentCount))}
              </div>
            )}

            {awaitingReturn && !done && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('rem.bulk.waiting')}
              </p>
            )}

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className={cn('gap-2', queue.length === 0 && 'sm:justify-center')}>
          {queue.length === 0 || done ? (
            <Button onClick={() => onOpenChange(false)}>{t('rem.bulk.close')}</Button>
          ) : !running ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('btn.cancel')}
              </Button>
              <Button onClick={start} className="gap-2">
                <Send className="h-4 w-4" />
                {t('rem.bulk.start').replace('{n}', String(queue.length))}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('rem.bulk.stop')}
              </Button>
              <Button variant="outline" onClick={skipCurrent} className="gap-2">
                <SkipForward className="h-4 w-4" />
                {t('rem.bulk.skip')}
              </Button>
              <Button onClick={() => void sendCurrent()} disabled={markSent.isPending} className="gap-2">
                {markSent.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />}
                {t('rem.bulk.send_next')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
