/**
 * Visit notes — per-customer entries staff record when a customer comes in.
 * Intentionally minimal (PRD Rule 10: data simplicity):
 *   • short text note
 *   • optional list of medicine names (no dosage/frequency/doctor fields)
 */
import { supabase, type Tables } from '@/lib/supabase';

export type VisitNote = Tables<'crm_visit_notes'>;

export async function listVisitNotes(customerId: string): Promise<VisitNote[]> {
  const { data, error } = await supabase
    .from('crm_visit_notes')
    .select('id, pharmacy_id, customer_id, note, medicines, added_by, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as VisitNote[];
}

export async function addVisitNote(args: {
  pharmacyId: string;
  customerId: string;
  note: string;
  medicines: string[];
}): Promise<VisitNote> {
  const note = args.note.trim();
  if (!note) throw new Error('Note text is required.');
  if (note.length > 1024) throw new Error('Note is too long (max 1024 chars).');
  const medicines = args.medicines.map((m) => m.trim()).filter(Boolean).slice(0, 20);

  const { data, error } = await supabase
    .from('crm_visit_notes')
    .insert({
      pharmacy_id: args.pharmacyId,
      customer_id: args.customerId,
      note,
      medicines,
    } as never)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as VisitNote;
}

export async function deleteVisitNote(id: string): Promise<void> {
  const { error } = await supabase.from('crm_visit_notes').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
