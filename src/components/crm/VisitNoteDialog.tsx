import { useEffect, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pill, X as XIcon, NotebookPen } from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { addVisitNote } from '@/lib/api/visitNotes';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface VisitNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

export function VisitNoteDialog({ open, onOpenChange, customerId, customerName }: VisitNoteDialogProps) {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const qc = useQueryClient();

  const [note, setNote] = useState('');
  const [medicines, setMedicines] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    setNote('');
    setMedicines([]);
    setDraft('');
  }, [open]);

  const commitDraft = () => {
    const next = draft.trim();
    if (!next) return;
    if (medicines.includes(next)) { setDraft(''); return; }
    if (medicines.length >= 20) return;
    setMedicines((m) => [...m, next]);
    setDraft('');
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && medicines.length) {
      setMedicines((m) => m.slice(0, -1));
    }
  };

  const removeMed = (m: string) => setMedicines((arr) => arr.filter((x) => x !== m));

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      await addVisitNote({ pharmacyId, customerId, note, medicines });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['visit-notes', customerId] });
      await qc.invalidateQueries({ queryKey: ['customer-activity', customerId] });
      // Refreshes the hero stat strip (last_visit_at / visit_count) since the
      // unified crm_customer_stats view now counts visit notes too.
      await qc.invalidateQueries({ queryKey: ['customer', customerId] });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
    },
  });

  const canSubmit = !!note.trim() && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-primary" />
            {t('visit.title')}
          </DialogTitle>
          <DialogDescription>
            {t('visit.subtitle').replace('{name}', customerName)}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) save.mutate(); }}
          className="space-y-4"
        >
          {/* Note */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('visit.note')} <span className="text-destructive">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('visit.note_placeholder')}
              required
              autoFocus
              maxLength={1024}
              className="block h-28 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="mt-1 flex justify-end font-mono text-[11px] text-muted-foreground">
              {note.length} / 1024
            </div>
          </div>

          {/* Medicine chips */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Pill className="h-3.5 w-3.5 text-muted-foreground" />
              {t('visit.medicines')}
              <span className="text-xs font-normal text-muted-foreground">({t('common.optional')})</span>
            </label>
            <div
              className={cn(
                'flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5',
                'focus-within:ring-2 focus-within:ring-ring'
              )}
            >
              {medicines.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {m}
                  <button
                    type="button"
                    onClick={() => removeMed(m)}
                    className="rounded hover:bg-primary/20"
                    aria-label={`Remove ${m}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKey}
                onBlur={commitDraft}
                placeholder={medicines.length ? '' : t('visit.medicines_placeholder')}
                disabled={medicines.length >= 20}
                className="h-7 min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{t('visit.medicines_hint')}</p>
          </div>

          {save.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {save.error.message}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {t('btn.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {save.isPending ? t('btn.saving') : t('visit.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
