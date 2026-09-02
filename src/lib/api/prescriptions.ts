/**
 * Prescriptions — header + medicine line items, with auto-reminder scheduling.
 * Ported from medcrm-app, narrowed per PRD Rule 10:
 *   • doctor_name / diagnosis / notes / dosage all stay optional.
 *   • No image upload, no doctor phone, no signature.
 *
 * On create:
 *   The PRESCRIPTION is the reminder entity. All medicines with a refill
 *   interval share ONE crm_scheduled_reminder, anchored on the shortest
 *   interval — a 5-medicine prescription produces one reminder, not five.
 *   A medicine flagged `reminder_override` opts out of that shared row and
 *   gets its own schedule instead, so the two can never both fire for it.
 */
import { supabase, rpc, type Tables } from '@/lib/supabase';

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
  /** Optional per-line price (₹) — used by the Quick-Rx upload tiles. */
  price?: number | null;
  /**
   * Opt this medicine out of the shared prescription reminder and give it its
   * own schedule. Default false — the prescription is the reminder entity, and
   * a 5-medicine prescription still produces exactly one reminder.
   */
  reminder_override?: boolean;
}

export interface PrescriptionInput {
  doctor_name: string | null;
  prescription_date: string;        // YYYY-MM-DD
  follow_up_date: string | null;    // YYYY-MM-DD
  follow_up_time?: string | null;   // HH:mm (e.g. '09:00')
  diagnosis: string | null;
  notes: string | null;
  attachment_url?: string | null;   // public URL of an uploaded scan (optional)
  total_cost?: number | null;
}


export async function listPrescriptions(customerId: string): Promise<PrescriptionWithMeds[]> {
  try {
    const { data, error } = await rpc<unknown[]>('crm_get_prescriptions_for_customer', {
      p_customer_id: customerId,
    });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data as PrescriptionWithMeds[];
    }
  } catch (e) {
    console.warn('[prescriptions] RPC failed, falling back:', e);
  }

  return listPrescriptionsFallback(customerId);
}

/** Fallback: 3-level sequential query used when the RPC is unavailable. */
async function listPrescriptionsFallback(customerId: string): Promise<PrescriptionWithMeds[]> {
  const { data: rxRows, error: rxErr } = await supabase
    .from('crm_prescriptions')
    .select('*')
    .eq('customer_id', customerId)
    .order('prescription_date', { ascending: false })
    .limit(50);
  if (rxErr) throw new Error(rxErr.message);
  const prescriptionList = ((rxRows ?? []) as unknown) as Prescription[];

  if (prescriptionList.length === 0) {
    return [];
  }

  const { data: medRows, error: medErr } = await supabase
    .from('crm_prescription_medicines')
    .select('*')
    .in('prescription_id', prescriptionList.map((p) => p.id))
    .order('position');
  if (medErr) throw new Error(medErr.message);
  const allMeds = ((medRows ?? []) as unknown) as PrescriptionMedicine[];

  const refillsByMed = await fetchRefillsByMedicine(allMeds.map((m) => m.id));

  return prescriptionList.map((p) => ({
    ...p,
    medicines: allMeds
      .filter((m) => m.prescription_id === p.id)
      .map((m) => attachRefillStats(m, refillsByMed.get(m.id) ?? [])),
  }));
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

async function getPrescription(id: string): Promise<PrescriptionWithMeds | null> {
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
    price: m.price ?? null,
    reminder_override: m.reminder_override ?? false,
  }));
  const { data: meds, error: medsErr } = await supabase
    .from('crm_prescription_medicines')
    .insert(rows as never)
    .select();
  if (medsErr) throw new Error(medsErr.message);

  // 3. Best-effort auto-schedule.
  // If follow_up_date is explicitly set, prioritize that as the prescription follow-up reminder.
  // Otherwise, auto-schedule refill reminders based on medicine refill intervals.
  const medNames = args.medicines.map((m) => m.medicine_name.trim()).filter(Boolean).join(', ');
  if (args.rx.follow_up_date) {
    await syncFollowUpReminder({
      prescriptionId: header.id,
      pharmacyId: args.pharmacyId,
      customerId: args.customerId,
      followUpDate: args.rx.follow_up_date,
      followUpTime: args.rx.follow_up_time,
      medicineNames: medNames,
    }).catch((e) => console.warn('[prescription] follow-up reminder sync skipped:', e));
  } else {
    const insertedIds = ((meds ?? []) as unknown as { id: string }[]).map((m) => m.id);
    await scheduleRefillReminders({
      prescriptionId: header.id,
      pharmacyId: args.pharmacyId,
      customerId: args.customerId,
      medicines: args.medicines,
      medicineIds: insertedIds,
    }).catch((e) => console.warn('[prescription] auto-reminder skipped:', e));
  }

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
  const { data: rxHead, error: headErr } = await supabase
    .from('crm_prescriptions')
    .update({
      doctor_name: args.rx.doctor_name?.trim() || null,
      prescription_date: args.rx.prescription_date,
      follow_up_date: args.rx.follow_up_date || null,
      diagnosis: args.rx.diagnosis?.trim() || null,
      notes: args.rx.notes?.trim() || null,
      total_cost: args.rx.total_cost ?? null,
    } as never)
    .eq('id', args.id)
    .select('pharmacy_id, customer_id')
    .single();
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
      price: m.price ?? null,
      reminder_override: m.reminder_override ?? false,
    }));
    const { error: insErr } = await supabase
      .from('crm_prescription_medicines')
      .insert(rows as never);
    if (insErr) throw new Error(insErr.message);
  }

  // Keep follow-up reminders in sync with updated date/time
  if (rxHead) {
    const headMeta = ((rxHead as unknown) as { pharmacy_id: string; customer_id: string });
    const medNames = args.medicines.map((m) => m.medicine_name.trim()).filter(Boolean).join(', ');
    await syncFollowUpReminder({
      prescriptionId: args.id,
      pharmacyId: headMeta.pharmacy_id,
      customerId: headMeta.customer_id,
      followUpDate: args.rx.follow_up_date || null,
      followUpTime: args.rx.follow_up_time || null,
      medicineNames: medNames,
    }).catch((e) => console.warn('[prescription] follow-up reminder sync skipped:', e));
  }
}


export async function deletePrescription(id: string): Promise<void> {
  // Cancel any pending reminders linked to this prescription first
  // (sent reminders are historical — leave them; only cancel unsent ones).
  await supabase
    .from('crm_scheduled_reminders')
    .update({ status: 'cancelled' } as never)
    .eq('prescription_id', id)
    .eq('status', 'pending');

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
      price: m.price,
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

/** Record multiple refills in a single batched multi-row insert. */
export async function recordRefills(items: RefillInput[]): Promise<PrescriptionRefill[]> {
  if (items.length === 0) return [];
  const rows = items.map((args) => ({
    pharmacy_id: args.pharmacyId,
    prescription_id: args.prescriptionId,
    medicine_id: args.medicineId,
    customer_id: args.customerId,
    quantity_dispensed: args.quantityDispensed,
    bill_amount: args.billAmount,
    notes: args.notes?.trim() || null,
  }));

  const { data, error } = await supabase
    .from('crm_prescription_refills')
    .insert(rows as never)
    .select();
  if (error) throw new Error(error.message);

  // The DB trigger `trg_crm_refill_schedule` (migration 06) handles
  // scheduling the next reminder automatically for each inserted refill.
  return (data as unknown) as PrescriptionRefill[];
}

/** Record a refill event and auto-schedule the NEXT reminder for this
 *  medicine using its refill_interval_days (if set). */
export async function recordRefill(args: RefillInput): Promise<PrescriptionRefill> {
  const [created] = await recordRefills([args]);
  if (!created) throw new Error('Failed to record refill');
  return created;
}

// ─── internal: auto-schedule reminders ─────────────────────────────────────────

async function scheduleRefillReminders(args: {
  prescriptionId: string;
  pharmacyId: string;
  customerId: string;
  medicines: MedicineInput[];
  /** Row ids of the medicines just inserted, in the same order as
   *  `medicines` — needed to point an override reminder at its medicine. */
  medicineIds?: (string | null)[];
}): Promise<void> {
  // Only medicines with a refill interval are eligible for any reminder.
  const eligible = args.medicines
    .map((m, i) => ({ med: m, id: args.medicineIds?.[i] ?? null }))
    .filter(({ med }) => (med.refill_interval_days ?? 0) > 0);
  if (eligible.length === 0) return;

  const { data: tpl } = await supabase
    .from('crm_templates')
    .select('id')
    .eq('kind', 'refill_reminder')
    .or(`pharmacy_id.is.null,pharmacy_id.eq.${args.pharmacyId}`)
    .order('is_built_in', { ascending: false })
    .limit(1)
    .maybeSingle();
  const templateId = (tpl as { id?: string } | null)?.id;
  if (!templateId) return;

  /** Fire (interval - 5) days out at 09:00 local, never sooner than tomorrow. */
  const fireAt = (intervalDays: number): string => {
    const when = new Date();
    when.setDate(when.getDate() + Math.max(intervalDays - 5, 1));
    when.setHours(9, 0, 0, 0);
    return when.toISOString();
  };

  type ReminderRow = {
    pharmacy_id: string;
    customer_id: string;
    prescription_id: string;
    medicine_id: string | null;
    template_id: string;
    scheduled_for: string;
    variables: Record<string, string>;
  };
  const rows: ReminderRow[] = [];

  // Medicines flagged as overrides get their own row each; everything else is
  // covered by ONE prescription-level row. Splitting them here is what keeps
  // the two from ever firing for the same medicine.
  const overrides = eligible.filter(({ med, id }) => med.reminder_override && id);
  const shared = eligible.filter(({ med, id }) => !(med.reminder_override && id));

  for (const { med, id } of overrides) {
    rows.push({
      pharmacy_id: args.pharmacyId,
      customer_id: args.customerId,
      prescription_id: args.prescriptionId,
      medicine_id: id,
      template_id: templateId,
      scheduled_for: fireAt(med.refill_interval_days as number),
      variables: { medicine: med.medicine_name },
    });
  }

  if (shared.length > 0) {
    // Anchor on the shortest interval so the single reminder lands before the
    // most urgent medicine in the group runs out.
    const minInterval = Math.min(
      ...shared.map(({ med }) => med.refill_interval_days as number)
    );
    rows.push({
      pharmacy_id: args.pharmacyId,
      customer_id: args.customerId,
      prescription_id: args.prescriptionId,
      medicine_id: null,
      template_id: templateId,
      scheduled_for: fireAt(minInterval),
      variables: { medicine: shared.map(({ med }) => med.medicine_name).join(', ') },
    });
  }

  if (rows.length === 0) return;

  const { error } = await supabase
    .from('crm_scheduled_reminders')
    .insert(rows as never);

  // 23505 = the partial unique indexes from migration 20260814_02. Means an
  // identical pending reminder already exists for that day, which is the
  // desired end state, not a failure.
  if (error && error.code !== '23505') {
    console.warn('[prescriptions] reminder scheduling failed:', error.message);
  }
}

function parseScheduledFor(dateStr: string, timeStr?: string | null): string {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] || new Date().getFullYear();
  const m = parts[1] || (new Date().getMonth() + 1);
  const d = parts[2] || new Date().getDate();
  const timeParts = (timeStr || '09:00').split(':').map(Number);
  const h = timeParts[0] || 9;
  const min = timeParts[1] || 0;
  const dt = new Date();
  dt.setFullYear(y, m - 1, d);
  dt.setHours(h, min, 0, 0);
  return dt.toISOString();
}

async function syncFollowUpReminder(args: {
  prescriptionId: string;
  pharmacyId: string;
  customerId: string;
  followUpDate: string | null;
  followUpTime?: string | null;
  medicineNames?: string;
}): Promise<void> {
  if (!args.followUpDate) {
    await supabase
      .from('crm_scheduled_reminders')
      .update({ status: 'cancelled' } as never)
      .eq('prescription_id', args.prescriptionId)
      .eq('status', 'pending');
    return;
  }

  const scheduledFor = parseScheduledFor(args.followUpDate, args.followUpTime);

  const { data } = await supabase
    .from('crm_scheduled_reminders')
    .select('id, variables')
    .eq('prescription_id', args.prescriptionId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  const existing = (data as unknown) as { id: string; variables?: Record<string, unknown> } | null;

  if (existing?.id) {
    const prevVars = ((existing.variables as Record<string, unknown>) || {});
    await supabase
      .from('crm_scheduled_reminders')
      .update({
        scheduled_for: scheduledFor,
        variables: {
          ...prevVars,
          medicine: args.medicineNames || (prevVars.medicine as string) || 'Follow-up Consultation',
        },
      } as never)
      .eq('id', existing.id);
  } else {
    const { data: tpl } = await supabase
      .from('crm_templates')
      .select('id')
      .or(`pharmacy_id.is.null,pharmacy_id.eq.${args.pharmacyId}`)
      .order('is_built_in', { ascending: false })
      .limit(1)
      .maybeSingle();

    const templateId = (tpl as { id?: string } | null)?.id;
    if (!templateId) return;

    await supabase.from('crm_scheduled_reminders').insert({
      pharmacy_id: args.pharmacyId,
      customer_id: args.customerId,
      prescription_id: args.prescriptionId,
      template_id: templateId,
      scheduled_for: scheduledFor,
      variables: {
        medicine: args.medicineNames || 'Follow-up Consultation',
      },
    } as never);
  }
}


