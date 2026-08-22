/**
 * Reminders bell API — list reminders due now/today, mark them sent or
 * cancelled. The actual WhatsApp send still goes through
 * `sendMessage()` in `messages.ts` (which respects rate limits + opt-out).
 */
import { supabase } from '@/lib/supabase';
import { renderTemplate } from '@/lib/utils';

// Small per-session cache so we don't re-fetch pharmacy name/phone on every send.
const pharmacyInfoCache = new Map<string, { name: string; phone: string | null }>();

/**
 * Render a reminder's WhatsApp body with all variables filled.
 * Merges, in priority order (later wins):
 *   1. {name}/{phone} from the reminder's customer
 *   2. {pharmacy_name}/{pharmacy_phone} from the pharmacy (fetched + cached)
 *   3. the reminder's own stored variables (e.g. {medicine})
 * Anything still unknown is left blank rather than showing a raw "{token}".
 */
export async function renderReminderMessage(args: {
  body: string;
  customerName?: string;
  customerPhone?: string;
  storedVars?: Record<string, unknown> | null;
  pharmacyId: string;
}): Promise<string> {
  const vars: Record<string, string> = {};
  if (args.customerName) vars.name = args.customerName;
  if (args.customerPhone) vars.phone = args.customerPhone;

  // Only hit the DB if the template actually references pharmacy fields.
  if (/\{pharmacy_(name|phone)\}/.test(args.body)) {
    let info = pharmacyInfoCache.get(args.pharmacyId);
    if (!info) {
      const { data } = await supabase
        .from('crm_pharmacies')
        .select('name, phone')
        .eq('id', args.pharmacyId)
        .maybeSingle();
      info = { name: (data as { name?: string } | null)?.name ?? '', phone: (data as { phone?: string | null } | null)?.phone ?? null };
      pharmacyInfoCache.set(args.pharmacyId, info);
    }
    vars.pharmacy_name = info.name;
    vars.pharmacy_phone = info.phone ?? '';
  }

  // Stored vars override the defaults above.
  for (const [k, v] of Object.entries(args.storedVars ?? {})) {
    if (v != null && v !== '') vars[k] = String(v);
  }

  // Fill the body; replace any STILL-unknown {token} with empty string so
  // customers never see a raw placeholder.
  const filled = renderTemplate(args.body, vars);
  return filled.replace(/\{\w+\}/g, '').replace(/[ \t]{2,}/g, ' ').trim();
}

export interface DueReminder {
  id: string;
  scheduled_for: string;
  status: string;
  sent_at?: string | null;
  variables: Record<string, string>;
  template_id: string;
  customer_id: string;
  customer: {
    id: string;
    name: string;
    phone: string;
    whatsapp_opted_in: boolean;
  } | null;
  template: {
    id: string;
    name: string;
    body: string;
    language: 'en' | 'hi';
  } | null;
}

/** List reminders due today (or overdue), plus reminders already sent today so they stay visible with Done tick mark. */
export async function listDueReminders(pharmacyId: string): Promise<DueReminder[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const { data, error } = await supabase
    .from('crm_scheduled_reminders')
    .select(`
      id, scheduled_for, status, sent_at, variables, template_id, customer_id,
      customer:crm_customers!inner(id, name, phone, whatsapp_opted_in),
      template:crm_templates!inner(id, name, body, language)
    `)
    .eq('pharmacy_id', pharmacyId)
    .or(`and(status.eq.pending,scheduled_for.lt.${startOfTomorrow}),and(status.in.(sent,converted),sent_at.gte.${startOfDay})`)
    .order('scheduled_for', { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown) as DueReminder[];
}

/** Mark a reminder as sent after the WhatsApp call succeeds. */
export async function markReminderSent(reminderId: string, messageId?: string): Promise<void> {
  const { error } = await supabase
    .from('crm_scheduled_reminders')
    .update({
      status: 'sent',
      message_id: messageId ?? null,
      sent_at: new Date().toISOString(),
    } as never)
    .eq('id', reminderId);
  if (error) throw new Error(error.message);
}

/** Skip a pending reminder — sets status to cancelled. */
export async function cancelReminder(reminderId: string): Promise<void> {
  const { error } = await supabase
    .from('crm_scheduled_reminders')
    .update({ status: 'cancelled' } as never)
    .eq('id', reminderId);
  if (error) throw new Error(error.message);
}

/** Reschedule a reminder to a new date/time and sync linked prescription follow_up_date. */
export async function rescheduleReminder(args: {
  reminderId: string;
  scheduledFor: string;
}): Promise<void> {
  const { data, error } = await supabase
    .from('crm_scheduled_reminders')
    .update({
      scheduled_for: args.scheduledFor,
      status: 'pending',
    } as never)
    .eq('id', args.reminderId)
    .select('prescription_id')
    .single();

  if (error) throw new Error(error.message);

  const rxId = ((data as unknown) as { prescription_id?: string | null } | null)?.prescription_id;
  if (rxId) {
    await supabase
      .from('crm_prescriptions')
      .update({
        follow_up_date: args.scheduledFor.slice(0, 10),
      } as never)
      .eq('id', rxId);
  }
}

