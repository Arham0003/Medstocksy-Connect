import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Stethoscope, Calendar as CalendarIcon, FileText,
  Pill, NotebookPen, AlertCircle, User as UserIcon, ClipboardPaste,
  Upload, X as XIcon, Sparkles, AlertTriangle, Clock,
} from 'lucide-react';
import { useActivePharmacy } from '@/contexts/PharmacyContext';
import { useT } from '@/contexts/LanguageContext';
import {
  createPrescription, updatePrescription,
  type PrescriptionWithMeds, type MedicineInput,
} from '@/lib/api/prescriptions';
import { supabase } from '@/lib/supabase';
import { signedBillUrl } from '@/lib/api/attachments';
import { usePdfExtraction } from '@/lib/pdf/usePdfExtraction';
import { getGeminiKey, hasGeminiKey } from '@/lib/aiKey';
import { extractBillData, GeminiAuthError } from '@/lib/gemini';
import { PRESCRIPTION_FIELDS } from '@/lib/ocr/fields';
import { validateExtraction } from '@/lib/ocr/validate';
import { cn, initials } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PrescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerAge?: number | null;
  customerGender?: 'male' | 'female' | 'other' | null;
  /** When provided, opens in edit mode pre-filled. */
  existing?: PrescriptionWithMeds | null;
}

const EMPTY_MED: MedicineInput = {
  medicine_name: '',
  form: '',
  strength: '',
  dosage: '',
  route: '',
  frequency: 'Once daily',
  quantity: null,
  duration_days: 30,
  refill_interval_days: 30,
  instructions: '',
  substitution_allowed: true,
  medicine_notes: '',
};

export function PrescriptionDialog({
  open, onOpenChange, customerId, customerName, customerPhone, customerAge, customerGender, existing,
}: PrescriptionDialogProps) {
  const t = useT();
  const { pharmacyId } = useActivePharmacy();
  const qc = useQueryClient();
  const isEdit = !!existing;

  const today = new Date().toISOString().slice(0, 10);

  const [doctor, setDoctor] = useState('');
  const [date, setDate] = useState(today);
  const [followUp, setFollowUp] = useState('');
  const [followUpTime, setFollowUpTime] = useState('09:00');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [medsText, setMedsText] = useState('');

  // PDF upload + extraction state
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachPath, setAttachPath] = useState<string | null>(null);
  const [attachName, setAttachName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const pdfExtraction = usePdfExtraction();
  const [extracting, setExtracting] = useState(false);
  const [extractedCount, setExtractedCount] = useState(0);
  const [extractNote, setExtractNote] = useState<string | null>(null);

  const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const MAX_BYTES = 10 * 1024 * 1024;

  // Convert textarea lines → MedicineInput[]
  const parsedMeds: MedicineInput[] = medsText
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(name => ({ ...EMPTY_MED, medicine_name: name }));

  useEffect(() => {
    if (!open) return;
    if (isEdit && existing) {
      setDoctor(existing.doctor_name ?? '');
      setDate(existing.prescription_date.slice(0, 10));
      setFollowUp(existing.follow_up_date?.slice(0, 10) ?? '');
      setFollowUpTime('09:00');
      setDiagnosis(existing.diagnosis ?? '');
      setNotes(existing.notes ?? '');
      setTotalCost(existing.total_cost?.toString() ?? '');
      // Pre-populate textarea with existing medicine names (one per line)
      setMedsText(existing.medicines.map(m => m.medicine_name).join('\n'));

      // Look up existing scheduled reminder time if present
      void supabase
        .from('crm_scheduled_reminders')
        .select('scheduled_for')
        .eq('prescription_id', existing.id)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          const row = (data as unknown) as { scheduled_for?: string } | null;
          if (row?.scheduled_for) {
            const d = new Date(row.scheduled_for);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            setFollowUpTime(`${hh}:${mm}`);
          }
        });
    } else {
      setDoctor('');
      setDate(today);
      setFollowUp('');
      setFollowUpTime('09:00');
      setDiagnosis('');
      setNotes('');
      setTotalCost('');
      setMedsText('');
    }
    // Reset upload state on every open
    setAttachPath(null); setAttachName(''); setUploadErr(null);
    setExtractedCount(0); setExtractNote(null); pdfExtraction.reset();
  }, [open, isEdit, existing, today, pdfExtraction]);



  const followUpInvalid = !!followUp && followUp < date;

  const save = useMutation<void, Error>({
    mutationFn: async () => {
      if (parsedMeds.length === 0) throw new Error('Paste at least one medicine name.');
      const total = parseFloat(totalCost);
      if (!totalCost.trim() || Number.isNaN(total) || total < 0) {
        throw new Error('Total cost of prescription is required.');
      }
      const rx = {
        doctor_name: doctor.trim() || null,
        prescription_date: date,
        follow_up_date: followUp || null,
        follow_up_time: followUp ? (followUpTime || '09:00') : null,
        diagnosis: diagnosis.trim() || null,
        notes: notes.trim() || null,
        total_cost: total,
        attachment_url: attachPath,
      };
      if (isEdit && existing) {
        await updatePrescription({ id: existing.id, rx, medicines: parsedMeds });
      } else {
        await createPrescription({ pharmacyId, customerId, rx, medicines: parsedMeds });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['prescriptions', customerId] });
      await qc.invalidateQueries({ queryKey: ['customer-activity', customerId] });
      await qc.invalidateQueries({ queryKey: ['scheduled-reminders'] });
      await qc.invalidateQueries({ queryKey: ['reminders-today'] });
      await qc.invalidateQueries({ queryKey: ['reminders-overdue'] });
      await qc.invalidateQueries({ queryKey: ['due-reminders'] });
      await qc.invalidateQueries({ queryKey: ['upcoming-reminders'] });
      await qc.invalidateQueries({ queryKey: ['dashboard-counts'] });
      await qc.invalidateQueries({ queryKey: ['customer', customerId] });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      onOpenChange(false);
    },
  });

  const canSubmit = !save.isPending && parsedMeds.length > 0 && !followUpInvalid && totalCost.trim() !== '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) save.mutate();
  };

  const subtitleText = (isEdit ? t('rx.subtitle_edit') : t('rx.subtitle_new')).replace('{name}', customerName);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {/* ── Header strip ── */}
        <div className="flex items-start gap-3 border-b bg-gradient-to-br from-primary/8 via-transparent to-transparent px-6 pb-5 pt-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogHeader className="space-y-0.5 text-left">
              <DialogTitle className="text-lg">
                {isEdit ? t('rx.title_edit') : t('rx.title_new')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {subtitleText}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <form id="rx-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">
          {/* Patient summary card */}
          <PatientCard
            name={customerName}
            phone={customerPhone}
            age={customerAge}
            gender={customerGender}
          />

          {/* ── PDF Upload section ── above Consultation ── */}
          <section className="mt-4 rounded-xl border bg-card/40 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Upload className="h-3.5 w-3.5" />
              </span>
              Import from Bill / Prescription PDF
              <span className="text-[10px] font-normal lowercase tracking-normal">({t('common.optional')})</span>
            </div>

            {!attachPath ? (
              <div
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors',
                  'border-border bg-background hover:border-primary/40 hover:bg-muted/30',
                  uploading && 'pointer-events-none opacity-60',
                )}
              >
                {uploading
                  ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  : <Upload className="h-5 w-5 text-muted-foreground" />}
                <p className="text-sm font-medium">{uploading ? 'Uploading…' : 'Drop or click to upload'}</p>
                <p className="text-[11px] text-muted-foreground">PDF, JPG, PNG · up to 10 MB · fields autofill from text-based PDFs</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{attachName}</span>
                <button
                  type="button"
                  onClick={() => { setAttachPath(null); setAttachName(''); setExtractedCount(0); setExtractNote(null); }}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              hidden
              accept={ALLOWED.join(',')}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!ALLOWED.includes(file.type)) { setUploadErr('Only PDF, JPG, PNG, WEBP allowed.'); return; }
                if (file.size > MAX_BYTES) { setUploadErr('File over 10 MB.'); return; }
                setUploadErr(null); setUploading(true);
                try {
                  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
                  const path = `${pharmacyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                  const { error: upErr } = await supabase.storage
                    .from('crm-bill-attachments')
                    .upload(path, file, { upsert: false, contentType: file.type });
                  if (upErr) throw upErr;
                  await signedBillUrl(path); // warm up the signed URL cache
                  setAttachPath(path);
                  setAttachName(file.name);

                  // Extract data from document (PDF or Image via Gemini)
                  setExtracting(true); setExtractedCount(0); setExtractNote(null);
                  try {
                    let docDoctor: string | null = null;
                    let docDiagnosis: string | null = null;
                    let docDate: string | null = null;
                    let docTotal: string | null = null;
                    let docMeds: string[] = [];

                    // 1. Digital PDF client-side parse
                    if (file.type === 'application/pdf') {
                      try {
                        const parsed = await pdfExtraction.extract(file);
                        if (parsed && !parsed.isScanned && parsed.medicines.length > 0) {
                          docDoctor = parsed.doctorName;
                          docDiagnosis = parsed.diagnosis;
                          docDate = parsed.date;
                          if (parsed.totalAmount !== null) docTotal = String(parsed.totalAmount);
                          docMeds = parsed.medicines.map(m => m.name);
                        }
                      } catch {
                        // Fall back to Gemini if available
                      }
                    }

                    // 2. Image or scanned/empty PDF: Gemini vision
                    if (docMeds.length === 0) {
                      if (hasGeminiKey()) {
                        try {
                          const raw = await extractBillData(getGeminiKey(), file, file.type, PRESCRIPTION_FIELDS);
                          const report = validateExtraction(PRESCRIPTION_FIELDS, raw);
                          if (report.fields.doctor?.value) docDoctor = String(report.fields.doctor.value);
                          if (report.fields.diagnosis?.value) docDiagnosis = String(report.fields.diagnosis.value);
                          if (report.fields.billDate?.value) docDate = String(report.fields.billDate.value);
                          if (report.fields.billAmount?.value) docTotal = String(report.fields.billAmount.value);
                          if (Array.isArray(report.fields.medicines?.value)) {
                            docMeds = report.fields.medicines.value as string[];
                          }
                        } catch (gemErr) {
                          if (gemErr instanceof GeminiAuthError) {
                            setExtractNote(gemErr.message);
                            return;
                          }
                          throw gemErr;
                        }
                      } else {
                        if (file.type === 'application/pdf') {
                          setExtractNote('Scanned PDF with no text layer. Configure Gemini API key in Settings → AI to enable AI extraction.');
                        } else {
                          setExtractNote('Add your Gemini API key in Settings → AI to enable AI data extraction from images.');
                        }
                        return;
                      }
                    }

                    // 3. Fill fields
                    let filled = 0;
                    const fill = (val: string | null, cur: string, set: (v: string) => void) => {
                      if (val && !cur.trim()) { set(val); filled += 1; }
                    };
                    fill(docDoctor, doctor, setDoctor);
                    fill(docDiagnosis, diagnosis, setDiagnosis);
                    if (docTotal) fill(docTotal, totalCost, setTotalCost);
                    if (docDate && date === today) { setDate(docDate); filled += 1; }
                    if (docMeds.length > 0 && !medsText.trim()) {
                      setMedsText(docMeds.join('\n'));
                      filled += docMeds.length;
                    }
                    if (filled > 0) {
                      setExtractedCount(filled);
                    } else {
                      setExtractNote('Could not detect medicines in this document. Enter them manually below.');
                    }
                  } finally {
                    setExtracting(false);
                  }
                } catch (err) {
                  setUploadErr(err instanceof Error ? err.message : 'Upload failed.');
                } finally {
                  setUploading(false);
                  if (fileRef.current) fileRef.current.value = '';
                }
              }}
            />

            {uploadErr && <p className="mt-2 text-xs text-destructive">{uploadErr}</p>}
            {extracting && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading document &amp; extracting medicines…
              </p>
            )}
            {!extracting && extractedCount > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600">
                <Sparkles className="h-3.5 w-3.5" /> {extractedCount} field{extractedCount !== 1 ? 's' : ''} extracted
              </p>
            )}
            {!extracting && extractNote && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" /> {extractNote}
              </p>
            )}
          </section>

          <div className="mt-5 space-y-5">
            {/* Section 1 — Consultation */}
            <Section icon={<Stethoscope className="h-4 w-4" />} title={t('rx.section_consultation')}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
                <Field label={t('rx.doctor')} optional>
                  <Input
                    value={doctor}
                    onChange={(e) => setDoctor(e.target.value)}
                    placeholder={t('rx.doctor_placeholder')}
                    maxLength={120}
                  />
                </Field>
                <Field
                  label={t('rx.date')}
                  required
                  icon={<CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                >
                  <Input
                    type="date"
                    className="font-mono"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    max={today}
                    required
                  />
                </Field>
                <Field
                  label={t('rx.follow_up')}
                  optional
                  icon={<CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                  error={followUpInvalid ? t('rx.follow_up_invalid') : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      className={cn('font-mono flex-1', followUpInvalid && 'border-destructive/60 focus-visible:ring-destructive/40')}
                      value={followUp}
                      onChange={(e) => setFollowUp(e.target.value)}
                      min={date}
                    />
                    {followUp && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          type="time"
                          className="w-24 font-mono text-xs h-10"
                          value={followUpTime}
                          onChange={(e) => setFollowUpTime(e.target.value)}
                          title={t('rx.follow_up_time')}
                        />
                      </div>
                    )}
                  </div>
                </Field>
              </div>

              <Field label={t('rx.diagnosis')} optional className="mt-3">
                <Input
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder={t('rx.diagnosis_placeholder')}
                  maxLength={240}
                />
              </Field>

              <Field label="Total Cost of Prescription (₹)" required className="mt-3">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={totalCost}
                  onChange={(e) => setTotalCost(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </Field>
            </Section>

            {/* Section 2 — Medicines */}
            <Section
              icon={<Pill className="h-4 w-4" />}
              title={t('rx.medicines')}
              required
            >
              <div className="space-y-2">
                <textarea
                  value={medsText}
                  onChange={e => setMedsText(e.target.value)}
                  placeholder={`Paste prescription here — one medicine per line:\n\nCrocin 500mg\nAzithromycin 250mg\nPan-D`}
                  rows={5}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {parsedMeds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {parsedMeds.map((m, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <ClipboardPaste className="h-3 w-3 opacity-60" />
                        {m.medicine_name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{isEdit ? t('rx.edit_note') : t('rx.auto_reminder_note')}</span>
              </p>
            </Section>

            {/* Section 3 — Notes */}
            <Section icon={<NotebookPen className="h-4 w-4" />} title={t('rx.notes')} optional>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('rx.notes_placeholder')}
                maxLength={1024}
                className={cn(
                  'block h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                )}
              />
              <div className="mt-1 flex justify-end font-mono text-[10px] text-muted-foreground">
                {notes.length} / 1024
              </div>
            </Section>

            {save.isError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {save.error.message}
              </div>
            )}
          </div>
        </form>

        {/* ── Sticky footer ── */}
        <DialogFooter className="border-t bg-muted/30 px-6 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('btn.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {save.isPending
              ? t('btn.saving')
              : (isEdit ? t('rx.save_edit') : t('rx.save_new'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Patient summary ─────────────────────────────────────────────────────────

function PatientCard({
  name, phone, age, gender,
}: {
  name: string; phone?: string; age?: number | null; gender?: 'male' | 'female' | 'other' | null;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card/50 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-bold text-primary ring-1 ring-primary/20">
        {initials(name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <UserIcon className="h-3 w-3 text-muted-foreground" />
          {name}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {phone && <span className="font-mono">{phone}</span>}
          {age != null && <span>· {age} {t('rx.years')}</span>}
          {gender && <span className="capitalize">· {gender}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Layout primitives ──────────────────────────────────────────────────────

function Section({
  icon, title, required, optional, actions, children,
}: {
  icon: ReactNode; title: string; required?: boolean; optional?: boolean;
  actions?: ReactNode; children: ReactNode;
}) {
  const t = useT();
  return (
    <section className="rounded-xl border bg-card/40 p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          {title}
          {required && <span className="text-destructive">*</span>}
          {optional && (
            <span className="text-[10px] font-normal lowercase tracking-normal text-muted-foreground">
              ({t('common.optional')})
            </span>
          )}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Field({
  label, required, optional, hint, error, icon, className, children,
}: {
  label: string; required?: boolean; optional?: boolean; hint?: string; error?: string;
  icon?: ReactNode; className?: string; children: ReactNode;
}) {
  const t = useT();
  return (
    <div className={className}>
      <label className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {label}
        {required && <span className="text-destructive">*</span>}
        {optional && (
          <span className="text-xs font-normal text-muted-foreground">({t('common.optional')})</span>
        )}
      </label>
      {children}
      {error
        ? <p className="mt-1 text-xs text-destructive">{error}</p>
        : hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
