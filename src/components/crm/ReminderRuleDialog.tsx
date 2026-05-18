import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Pill, CalendarClock, MessageSquare, Power, ShoppingBag, Bell, RefreshCcw,
} from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import { supabase, type Tables } from '@/lib/supabase';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { deduplicateTemplates } from '@/lib/crm/templates';

type Rule = Tables<'crm_reminder_rules'>;
type Template = Tables<'crm_templates'>;

interface ReminderRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog opens in edit mode pre-filled with this rule */
  rule?: Rule | null;
}

export function ReminderRuleDialog({ open, onOpenChange, rule }: ReminderRuleDialogProps) {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const qc = useQueryClient();
  const isEdit = !!rule;

  const [medicineLabel, setMedicineLabel] = useState('');
  const [refillCycle, setRefillCycle] = useState(30);
  const [reminderOffset, setReminderOffset] = useState(5);
  const [templateId, setTemplateId] = useState('');
  const [sendTime, setSendTime] = useState('09:00');
  const [isActive, setIsActive] = useState(true);

  // Load all approved templates (built-ins + this pharmacy's customs).
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['rule-templates', pharmacyId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_templates')
        .select('*')
        .or(`pharmacy_id.is.null,pharmacy_id.eq.${pharmacyId}`)
        .eq('whatsapp_status', 'approved')
        .order('is_built_in', { ascending: false });
      if (error) throw error;
      return deduplicateTemplates((data ?? []) as unknown as Template[]);
    },
  });

  // Hydrate fields whenever dialog opens (edit) or resets (create).
  useEffect(() => {
    if (!open) return;
    if (isEdit && rule) {
      setMedicineLabel(rule.medicine_label);
      setRefillCycle(rule.refill_cycle_days);
      setReminderOffset(rule.reminder_offset_days);
      setTemplateId(rule.template_id);
      setSendTime(rule.send_time.slice(0, 5));
      setIsActive(rule.is_active);
    } else {
      setMedicineLabel('');
      setRefillCycle(30);
      setReminderOffset(5);
      // Default to T2 (refill_reminder) if available
      const defaultTpl = templates.find((tt) => tt.kind === 'refill_reminder');
      setTemplateId(defaultTpl?.id ?? '');
      setSendTime('09:00');
      setIsActive(true);
    }
  }, [open, isEdit, rule, templates]);

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      if (!medicineLabel.trim()) throw new Error('Medicine label is required.');
      if (refillCycle < 1 || refillCycle > 365) throw new Error('Refill cycle must be 1–365 days.');
      if (reminderOffset < 0 || reminderOffset > 90) throw new Error('Reminder offset must be 0–90 days.');
      if (reminderOffset >= refillCycle) {
        throw new Error('Reminder offset must be smaller than the refill cycle.');
      }
      if (!templateId) throw new Error('Pick a message template.');

      const payload = {
        pharmacy_id: pharmacyId,
        medicine_label: medicineLabel.trim(),
        refill_cycle_days: refillCycle,
        reminder_offset_days: reminderOffset,
        template_id: templateId,
        send_time: `${sendTime}:00`,
        is_active: isActive,
      };

      if (isEdit && rule) {
        const { error } = await supabase
          .from('crm_reminder_rules')
          .update(payload as never)
          .eq('id', rule.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('crm_reminder_rules')
          .insert(payload as never);
        if (error) {
          if (error.code === '23505') {
            throw new Error(`A rule for "${medicineLabel}" already exists. Edit that one instead.`);
          }
          throw new Error(error.message);
        }
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['reminder-rules'] });
      onOpenChange(false);
    },
  });

  const canSubmit = !!medicineLabel.trim() && !!templateId && !save.isPending;
  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === templateId) ?? null,
    [templates, templateId]
  );
  const fireDay = Math.max(refillCycle - reminderOffset, 0);
  const offsetInvalid = reminderOffset >= refillCycle && refillCycle > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        {/* Header strip */}
        <div className="flex items-start gap-3 border-b bg-gradient-to-br from-primary/5 via-transparent to-transparent px-6 pb-5 pt-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogHeader className="space-y-0.5 text-left">
              <DialogTitle className="text-lg">
                {isEdit ? t('rule.title_edit') : t('rule.title_new')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t('reminders.subtitle')}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) save.mutate(); }}
          className="space-y-5 px-6 pb-2 pt-5"
        >
          {/* ── Section 1 · Trigger ─────────────────────────────────────────── */}
          <Section icon={<Pill className="h-4 w-4" />} title={t('rule.section_trigger') ?? 'Trigger'}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
              <Field
                label={t('rule.medicine')}
                required
                hint={t('rule.medicine_hint') ?? 'Use a label your team recognises (e.g. "BP medicine").'}
              >
                <Input
                  value={medicineLabel}
                  onChange={(e) => setMedicineLabel(e.target.value)}
                  placeholder='e.g. "BP medicine"'
                  required
                  autoFocus
                  maxLength={80}
                />
              </Field>
              <Field label={t('rule.cycle')} hint={t('rule.cycle_hint')}>
                <UnitInput
                  type="number"
                  min={1}
                  max={365}
                  value={refillCycle}
                  onChange={(v) => setRefillCycle(v)}
                  unit={t('rule.unit_days') ?? 'days'}
                />
              </Field>
            </div>
          </Section>

          {/* ── Section 2 · Schedule ────────────────────────────────────────── */}
          <Section
            icon={<CalendarClock className="h-4 w-4" />}
            title={t('rule.section_schedule') ?? 'Schedule'}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label={t('rule.offset')}
                hint={t('rule.offset_hint')}
                error={offsetInvalid ? (t('rule.offset_invalid') ?? 'Offset must be smaller than the refill cycle.') : undefined}
              >
                <UnitInput
                  type="number"
                  min={0}
                  max={90}
                  value={reminderOffset}
                  onChange={(v) => setReminderOffset(v)}
                  unit={t('rule.unit_days_before') ?? 'days before'}
                  invalid={offsetInvalid}
                />
              </Field>
              <Field label={t('rule.send_time')} hint={t('rule.send_time_hint') ?? 'Local pharmacy time (IST).'}>
                <Input
                  type="time"
                  className="h-10 font-mono"
                  value={sendTime}
                  onChange={(e) => setSendTime(e.target.value)}
                />
              </Field>
            </div>

            {/* Live timeline visualisation */}
            <Timeline
              cycle={refillCycle}
              fireDay={fireDay}
              sendTime={sendTime}
            />
          </Section>

          {/* ── Section 3 · Message ─────────────────────────────────────────── */}
          <Section
            icon={<MessageSquare className="h-4 w-4" />}
            title={t('rule.section_message') ?? 'Message'}
          >
            <Field label={t('rule.template')} required>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="" disabled>—</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.is_built_in ? '★ ' : ''}{tpl.name}
                    {tpl.language === 'hi' ? '  ·  हिन्दी' : '  ·  EN'}
                  </option>
                ))}
              </select>
            </Field>

            {selectedTemplate && (
              <div className="mt-3 rounded-xl border border-emerald-200/60 bg-emerald-50/70 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/30">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  <span>{t('rule.template_preview') ?? 'Preview'}</span>
                  <span className="font-mono text-[10px]">
                    {selectedTemplate.language === 'hi' ? 'हिन्दी' : 'EN'}
                  </span>
                </div>
                {selectedTemplate.image_url && (
                  <img 
                    src={selectedTemplate.image_url} 
                    alt="" 
                    className="mb-3 aspect-video w-full rounded-lg border object-cover shadow-sm" 
                  />
                )}
                <p
                  lang={selectedTemplate.language ?? 'en'}
                  className={cn(
                    'whitespace-pre-wrap text-sm leading-relaxed text-foreground/90',
                    selectedTemplate.language === 'hi' && 'font-["Noto_Sans_Devanagari",Inter,system-ui]'
                  )}
                >
                  {selectedTemplate.body}
                </p>
              </div>
            )}
          </Section>

          {/* ── Section 4 · Status toggle ───────────────────────────────────── */}
          <button
            type="button"
            onClick={() => setIsActive((v) => !v)}
            aria-pressed={isActive}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
              isActive
                ? 'border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-700/60 dark:bg-emerald-950/30'
                : 'border-border bg-muted/40 hover:bg-muted/60'
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted-foreground/10 text-muted-foreground'
              )}
            >
              <Power className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t('rule.active')}</div>
              <div className="text-xs text-muted-foreground">{t('rule.active_hint')}</div>
            </div>
            <span
              className={cn(
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                isActive ? 'bg-emerald-500' : 'bg-muted-foreground/30'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-background shadow-card transition-transform',
                  isActive ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </span>
          </button>

          {save.isError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {save.error?.message ?? t('common.unknown')}
            </div>
          )}
        </form>

        <DialogFooter className="border-t bg-muted/30 px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('btn.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => { if (canSubmit) save.mutate(); }}
            disabled={!canSubmit || offsetInvalid}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {save.isPending
              ? (isEdit ? t('btn.saving') : t('btn.creating'))
              : (isEdit ? t('btn.update_rule') : t('btn.create_rule'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Layout primitives ──────────────────────────────────────────────────────

function Section({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card/40 p-4">
      <header className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        {title}
      </header>
      {children}
    </section>
  );
}

function Field({
  label, hint, error, required, children,
}: {
  label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error
        ? <p className="mt-1 text-xs text-destructive">{error}</p>
        : hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Number input with a static unit suffix (e.g. "days") rendered inline. */
function UnitInput({
  value, onChange, unit, min, max, invalid,
}: {
  value: number; onChange: (v: number) => void;
  unit: string; min: number; max: number; type: 'number'; invalid?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-10 items-stretch overflow-hidden rounded-md border border-input bg-background',
        'focus-within:ring-2 focus-within:ring-ring',
        invalid && 'border-destructive/60 focus-within:ring-destructive/40'
      )}
    >
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm focus:outline-none"
      />
      <span className="flex shrink-0 select-none items-center border-l bg-muted/40 px-2.5 text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

/** Three-stop timeline: sale → reminder → refill due. */
function Timeline({
  cycle, fireDay, sendTime,
}: {
  cycle: number; fireDay: number; sendTime: string;
}) {
  const t = useT();
  const safeCycle = Math.max(cycle, 1);
  const firePct = Math.min(Math.max((fireDay / safeCycle) * 100, 0), 100);
  return (
    <div className="mt-3 rounded-xl border bg-background/60 p-3">
      <div className="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{t('rule.timeline')}</span>
        <span className="font-mono text-foreground/80">
          {`Day 0 → Day ${fireDay} (${sendTime}) → Day ${cycle}`}
        </span>
      </div>

      {/* Track */}
      <div className="relative mx-2 h-1.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-400 to-amber-400"
          style={{ width: `${firePct}%` }}
        />
        <span
          className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-emerald-500 bg-background shadow"
          style={{ left: '0%' }}
          aria-label="Sale"
        />
        <span
          className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-amber-500 bg-background shadow"
          style={{ left: `${firePct}%` }}
          aria-label="Reminder"
        />
        <span
          className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-rose-500 bg-background shadow"
          style={{ left: '100%' }}
          aria-label="Refill due"
        />
      </div>

      {/* Stop labels */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stop
          icon={<ShoppingBag className="h-3 w-3" />}
          tone="emerald"
          title={t('rule.stop_sale')}
          subtitle={`Day 0`}
        />
        <Stop
          icon={<Bell className="h-3 w-3" />}
          tone="amber"
          title={t('rule.stop_reminder')}
          subtitle={`Day ${fireDay} · ${sendTime}`}
        />
        <Stop
          icon={<RefreshCcw className="h-3 w-3" />}
          tone="rose"
          title={t('rule.stop_refill')}
          subtitle={`Day ${cycle}`}
        />
      </div>
    </div>
  );
}

function Stop({
  icon, title, subtitle, tone,
}: {
  icon: React.ReactNode; title: string; subtitle: string;
  tone: 'emerald' | 'amber' | 'rose';
}) {
  const ring =
    tone === 'emerald' ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
    : tone === 'amber' ? 'border-amber-500/40 text-amber-600 dark:text-amber-400'
    : 'border-rose-500/40 text-rose-600 dark:text-rose-400';
  return (
    <div className="flex items-start gap-2">
      <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background', ring)}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-medium text-foreground">{title}</div>
        <div className="font-mono text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}
