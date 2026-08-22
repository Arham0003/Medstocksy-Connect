import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { rescheduleReminder } from '@/lib/api/reminders';
import { useT } from '@/contexts/LanguageContext';

interface RescheduleReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reminder: {
    id: string;
    scheduled_for: string;
    customer?: { name?: string; phone?: string } | null;
    variables?: Record<string, string>;
  } | null;
}

export function RescheduleReminderDialog({
  open,
  onOpenChange,
  reminder,
}: RescheduleReminderDialogProps) {
  const t = useT();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');

  useEffect(() => {
    if (!open || !reminder) return;
    try {
      const d = new Date(reminder.scheduled_for);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setDate(`${yyyy}-${mm}-${dd}`);
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      setTime(`${hh}:${min}`);
    } catch {
      setDate(today);
      setTime('09:00');
    }
  }, [open, reminder, today]);

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      if (!reminder) return;
      if (!date) throw new Error('Please select a date.');
      const parts = date.split('-').map(Number);
      const y = parts[0] || new Date().getFullYear();
      const m = parts[1] || (new Date().getMonth() + 1);
      const d = parts[2] || new Date().getDate();
      const timeParts = (time || '09:00').split(':').map(Number);
      const h = timeParts[0] || 9;
      const min = timeParts[1] || 0;
      const target = new Date();
      target.setFullYear(y, m - 1, d);
      target.setHours(h, min, 0, 0);

      await rescheduleReminder({
        reminderId: reminder.id,
        scheduledFor: target.toISOString(),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['scheduled-reminders'] });
      await qc.invalidateQueries({ queryKey: ['reminders-today'] });
      await qc.invalidateQueries({ queryKey: ['reminders-overdue'] });
      await qc.invalidateQueries({ queryKey: ['due-reminders'] });
      await qc.invalidateQueries({ queryKey: ['upcoming-reminders'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-counts'] });
      await qc.invalidateQueries({ queryKey: ['prescriptions'] });
      onOpenChange(false);
    },
  });

  if (!reminder) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            {t('rem.reschedule_title')}
          </DialogTitle>
          <DialogDescription>
            {t('rem.reschedule_desc')}
            {reminder.customer?.name && (
              <span className="block mt-1 font-medium text-foreground">
                Customer: {reminder.customer.name} {reminder.variables?.medicine && `(${reminder.variables.medicine})`}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (date && !save.isPending) save.mutate();
          }}
          className="space-y-4 py-2"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Follow-up Date</label>
              <Input
                type="date"
                className="font-mono"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={today}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Follow-up Time</label>
              <Input
                type="time"
                className="font-mono"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </div>
          </div>

          {save.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {save.error?.message}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!date || save.isPending}
              className="gap-2"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {save.isPending ? 'Saving…' : t('rem.reschedule_save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
