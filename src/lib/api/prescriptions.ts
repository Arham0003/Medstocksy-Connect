/**
 * Prescriptions — header + medicine line items, with auto-reminder scheduling.
 * Ported from medcrm-app, narrowed per PRD Rule 10:
 *   • doctor_name / diagnosis / notes / dosage all stay optional.
 *   • No image upload, no doctor phone, no signature.
 *
 * On create:
 *   For each medicine line with refill_interval_days > 0, schedules a
 *   crm_scheduled_reminder using the pharmacy's first refill_reminder
 *   template. Days are staggered (+i days per index) so a 4-medicine Rx
 *   doesn't fire 4 reminders on the same morning.
 */
import { supabase, type Tables } from '@/lib/supabase';

export type Prescription = Tables<'crm_prescriptions'>;
export type PrescriptionMedicine = Tables<'crm_prescription_medicines'>;
export type PrescriptionRefill = Tables<'crm_prescription_refills'>;

/** Per-medicine refill rollup attached to MedicineWithRefills. */
export interface MedicineRefillStats {
  count: number;
  last_refilled_at: string | null;
  /** Next due date computed as last_refilled_at + refill_interval_days. */
  next_due_at: string | null;
}

export interface MedicineWithRefills extends PrescriptionMedicine {
  refill_stats: MedicineRefillStats;
}

export interface PrescriptionWithMeds extends Prescription {
  medicines: MedicineWithRefills[];
}

export interface MedicineInput {
  medicine_name: string;
  form: string | null;
  strength: string | null;
  dosage: string | null;
  route: string | null;
  frequency: string;
  quantity: number | null;
  duration_days: number | null;
  refill_interval_days: number | null;
  instructions: string | null;
  substitution_allowed: boolean;
  medicine_notes: string | null;
}

export interface PrescriptionInput {
  doctor_name: string | null;
  prescription_date: string;        // YYYY-MM-DD
  follow_up_date: string | null;    // YYYY-MM-DD
  diagnosis: string | null;
  notes: string | null;
  attachment_url?: string | null;   // public URL of an uploaded scan (optional)
  total_cost?: number | null;
}

export async function listPrescriptions(customerId: string): Promise<PrescriptionWithMeds[]> {
  const { data: rxs, error } = await supabase
    .from('crm_prescriptions')
    .select('*')
    .eq('customer_id', customerId)
    .order('prescription_date', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const headers = ((rxs ?? []) as unknown) as Prescription[];
  if (headers.length === 0) return [];

  const ids = headers.map((r) => r.id);
  const { data: meds, error: medsErr } = await supabase
    .from('crm_prescription_medicines')
    .select('*')
    .in('prescription_id', ids)
    .order('position');
  if (medsErr) throw new Error(medsErr.message);
  const medRows = ((meds ?? []) as unknown) as PrescriptionMedicine[];

  // Fetch refills for these medicines in one shot.
  const medIds = medRows.map((m) => m.id);
  const refillsByMed = await fetchRefillsByMedicine(medIds);
  const medsByRx = new Map<string, MedicineWithRefills[]>();
  medRows.forEach((m) => {
    const arr = medsByRx.get(m.prescription_id) ?? [];
    arr.push(attachRefillStats(m, refillsByMed.get(m.id) ?? []));
    medsByRx.set(m.prescription_id, arr);
  });

  return headers.map((h) => ({ ...h, medicines: medsByRx.get(h.id) ?? [] }));
}

async function fetchRefillsByMedicine(medIds: string[]): Promise<Map<string, PrescriptionRefill[]>> {
  const out = new Map<string, PrescriptionRefill[]>();
  if (medIds.length === 0) return out;
  const { data, error } = await supabase
    .from('crm_prescription_refills')
    .select('*')
    .in('medicine_id', medIds)
    .order('refilled_at', { ascending: false });
  if (error) throw new Error(error.message);
  ((data ?? []) as unknown as PrescriptionRefill[]).forEach((r) => {
    const arr = out.get(r.medicine_id) ?? [];
    arr.push(r);
    out.set(r.medicine_id, arr);
  });
  return out;
}

function attachRefillStats(
  med: PrescriptionMedicine,
  refills: PrescriptionRefill[]
): MedicineWithRefills {
  const count = refills.length;
  const last = refills[0]?.refilled_at ?? null;
  let next_due_at: string | null = null;
  if (last && (med.refill_interval_days ?? 0) > 0) {
    const d = new Date(last);
    d.setDate(d.getDate() + (med.refill_interval_days as number));
    next_due_at = d.toISOString();
  }
  return {
    ...med,
    refill_stats: { count, last_refilled_at: last, next_due_at },
  };
}

export async function getPrescription(id: string): Promise<PrescriptionWithMeds | null> {
  const { data: head, error } = await supabase
    .from('crm_prescriptions')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(error.message);
  }
  const { data: meds, error: medsErr } = await supabase
    .from('crm_prescription_medicines')
    .select('*')
    .eq('prescription_id', id)
    .order('position');
  if (medsErr) throw new Error(medsErr.message);
  const medRows = ((meds ?? []) as unknown) as PrescriptionMedicine[];
  const refillsByMed = await fetchRefillsByMedicine(medRows.map((m) => m.id));
  return {
    ...((head as unknown) as Prescription),
    medicines: medRows.map((m) => attachRefillStats(m, refillsByMed.get(m.id) ?? [])),
  };
}

export async function createPrescription(args: {
  pharmacyId: string;
  customerId: string;
  rx: PrescriptionInput;
  medicines: MedicineInput[];
}): Promise<PrescriptionWithMeds> {
  if (args.medicines.length === 0 || args.medicines.some((m) => !m.medicine_name.trim())) {
    throw new Error('Every medicine line needs a name.');
  }

  // 1. Header
  const { data: head, error: headErr } = await supabase
    .from('crm_prescriptions')
    .insert({
      pharmacy_id: args.pharmacyId,
      customer_id: args.customerId,
      doctor_name: args.rx.doctor_name?.trim() || null,
      prescription_date: args.rx.prescription_date,
      follow_up_date: args.rx.follow_up_date || null,
      diagnosis: args.rx.diagnosis?.trim() || null,
      notes: args.rx.notes?.trim() || null,
      attachment_url: args.rx.attachment_url ?? null,
      total_cost: args.rx.total_cost ?? null,
    } as never)
    .select()
    .single();
  if (headErr) throw new Error(headErr.message);
  const header = (head as unknown) as Prescription;

  // 2. Medicine rows
  const rows = args.medicines.map((m, i) => ({
    prescription_id: header.id,
    position: i,
    medicine_name: m.medicine_name.trim(),
    form: m.form?.trim() || null,
    strength: m.strength?.trim() || null,
    dosage: m.dosage?.trim() || null,
    route: m.route?.trim() || null,
    frequency: m.frequency || 'Once daily',
    quantity: m.quantity || null,
    duration_days: m.duration_days || null,
    refill_interval_days: m.refill_interval_days || null,
    instructions: m.instructions?.trim() || null,
    substitution_allowed: m.substitution_allowed,
    medicine_notes: m.medicine_notes?.trim() || null,
  }));
  const { data: meds, error: medsErr } = await supabase
    .from('crm_prescription_medicines')
    .insert(rows as never)
    .select();
  if (medsErr) throw new Error(medsErr.message);

  // 3. Best-effort auto-schedule refill reminders (one per medicine line
  //    with a refill interval, staggered +i days).
  await scheduleRefillReminders({
    pharmacyId: args.pharmacyId,
    customerId: args.customerId,
    medicines: args.medicines,
  }).catch((e) => console.warn('[prescription] auto-reminder skipped:', e));

  // Freshly-created prescriptions have zero refills — attach empty stats so
  // the return type matches PrescriptionWithMeds.
  const fresh = ((meds ?? []) as unknown) as PrescriptionMedicine[];
  return {
    ...header,
    medicines: fresh.map((m) => attachRefillStats(m, [])),
  };
}

export async function updatePrescription(args: {
  id: string;
  rx: PrescriptionInput;
  medicines: MedicineInput[];
}): Promise<void> {
  const { error: headErr } = await supabase
    .from('crm_prescriptions')
    .update({
      doctor_name: args.rx.doctor_name?.trim() || null,
      prescription_date: args.rx.prescription_date,
      follow_up_date: args.rx.follow_up_date || null,
      diagnosis: args.rx.diagnosis?.trim() || null,
      notes: args.rx.notes?.trim() || null,
      total_cost: args.rx.total_cost ?? null,
    } as never)
    .eq('id', args.id);
  if (headErr) throw new Error(headErr.message);

  // Replace the medicine rows wholesale — simpler than diffing.
  const { error: delErr } = await supabase
    .from('crm_prescription_medicines')
    .delete()
    .eq('prescription_id', args.id);
  if (delErr) throw new Error(delErr.message);

  if (args.medicines.length > 0) {
    const rows = args.medicines.map((m, i) => ({
      prescription_id: args.id,
      position: i,
      medicine_name: m.medicine_name.trim(),
      form: m.form?.trim() || null,
      strength: m.strength?.trim() || null,
      dosage: m.dosage?.trim() || null,
      route: m.route?.trim() || null,
      frequency: m.frequency || 'Once daily',
      quantity: m.quantity || null,
      duration_days: m.duration_days || null,
      refill_interval_days: m.refill_interval_days || null,
      instructions: m.instructions?.trim() || null,
      substitution_allowed: m.substitution_allowed,
      medicine_notes: m.medicine_notes?.trim() || null,
    }));
    const { error: insErr } = await supabase
      .from('crm_prescription_medicines')
      .insert(rows as never);
    if (insErr) throw new Error(insErr.message);
  }
}

export async function deletePrescription(id: string): Promise<void> {
  const { error } = await supabase.from('crm_prescriptions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Clone a prescription with today's date and re-schedule refill reminders. */
export async function renewPrescription(id: string): Promise<PrescriptionWithMeds> {
  const original = await getPrescription(id);
  if (!original) throw new Error('Prescription not found.');
  return createPrescription({
    pharmacyId: original.pharmacy_id,
    customerId: original.customer_id,
    rx: {
      doctor_name: original.doctor_name,
      prescription_date: new Date().toISOString().slice(0, 10),
      follow_up_date: null,  // user explicitly sets a new follow-up if needed
      diagnosis: original.diagnosis,
      notes: original.notes,
      total_cost: original.total_cost,
    },
    medicines: original.medicines.map((m) => ({
      medicine_name: m.medicine_name,
      form: m.form,
      strength: m.strength,
      dosage: m.dosage,
      route: m.route,
      frequency: m.frequency,
      quantity: m.quantity,
      duration_days: m.duration_days,
      refill_interval_days: m.refill_interval_days,
      instructions: m.instructions,
      substitution_allowed: m.substitution_allowed,
      medicine_notes: m.medicine_notes,
    })),
  });
}

// ─── Refills ─────────────────────────────────────────────────────────────────

export interface RefillInput {
  prescriptionId: string;
  medicineId: string;
  customerId: string;
  pharmacyId: string;
  quantityDispensed: number | null;
  billAmount: number | null;
  notes: string | null;
}

/** Record a refill event and auto-schedule the NEXT reminder for this
 *  medicine using its refill_interval_days (if set). */
export async function recordRefill(args: RefillInput): Promise<PrescriptionRefill> {
  const { data, error } = await supabase
    .from('crm_prescription_refills')
    .insert({
      pharmacy_id: args.pharmacyId,
      prescription_id: args.prescriptionId,
      medicine_id: args.medicineId,
      customer_id: args.customerId,
      quantity_dispensed: args.quantityDispensed,
      bill_amount: args.billAmount,
      notes: args.notes?.trim() || null,
    } as never)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Schedule the next reminder. Fire (refill_interval_days - 5) from now at
  // 09:00 IST, matching the create-prescription scheduler's offset.
  await scheduleNextRefillReminder(args.medicineId, args.pharmacyId, args.customerId)
    .catch((e) => console.warn('[refill] next reminder skipped:', e));

  return (data as unknown) as PrescriptionRefill;
}

async function scheduleNextRefillReminder(
  medicineId: string, pharmacyId: string, customerId: string
): Promise<void> {
  const { data: med } = await supabase
    .from('crm_prescription_medicines')
    .select('medicine_name, refill_interval_days')
    .eq('id', medicineId)
    .maybeSingle();
  const row = med as { medicine_name?: string; refill_interval_days?: number | null } | null;
  const interval = row?.refill_interval_days ?? 0;
  if (!row || interval <= 0) return;

  const { data: tpl } = await supabase
    .from('crm_templates')
    .select('id')
    .eq('kind', 'refill_reminder')
    .or(`pharmacy_id.is.null,pharmacy_id.eq.${pharmacyId}`)
    .order('is_built_in', { ascending: false })
    .limit(1)
    .maybeSingle();
  const templateId = (tpl as { id?: string } | null)?.id;
  if (!templateId) return;

  const when = new Date();
  when.setDate(when.getDate() + Math.max(interval - 5, 1));
  when.setHours(9, 0, 0, 0);

  await supabase.from('crm_scheduled_reminders').insert({
    pharmacy_id: pharmacyId,
    customer_id: customerId,
    template_id: templateId,
    scheduled_for: when.toISOString(),
    variables: { medicine: row.medicine_name ?? '' },
  } as never);
}

export async function listRefills(medicineId: string): Promise<PrescriptionRefill[]> {
  const { data, error } = await supabase
    .from('crm_prescription_refills')
    .select('*')
    .eq('medicine_id', medicineId)
    .order('refilled_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as PrescriptionRefill[];
}

// ─── internal: auto-schedule reminders ─────────────────────────────────────────

async function scheduleRefillReminders(args: {
  pharmacyId: string;
  customerId: string;
  medicines: MedicineInput[];
}): Promise<void> {
  // Pick a refill_reminder template the user has access to.
  const { data: tpl } = await supabase
    .from('crm_templates')
    .select('id')
    .eq('kind', 'refill_reminder')
    .or(`pharmacy_id.is.null,pharmacy_id.eq.${args.pharmacyId}`)
    .order('is_built_in', { ascending: false })
    .limit(1)
    .maybeSingle();
  const templateId = (tpl as { id?: string } | null)?.id;
  if (!templateId) return;  // No template, nothing to schedule.

  const rows = args.medicines
    .map((m, i) => ({ med: m, idx: i }))
    .filter(({ med }) => (med.refill_interval_days ?? 0) > 0)
    .map(({ med, idx }) => {
      const when = new Date();
      // Fire (interval - 5) days from now, +idx stagger, default 9:00 IST.
      const offset = Math.max((med.refill_interval_days ?? 30) - 5, 1) + idx;
      when.setDate(when.getDate() + offset);
      when.setHours(9, 0, 0, 0);
      return {
        pharmacy_id: args.pharmacyId,
        customer_id: args.customerId,
        template_id: templateId,
        scheduled_for: when.toISOString(),
        variables: { medicine: med.medicine_name },
      };
    });
  if (rows.length === 0) return;

  await supabase.from('crm_scheduled_reminders').insert(rows as never);
}
