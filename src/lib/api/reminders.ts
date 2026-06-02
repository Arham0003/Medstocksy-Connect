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

/** List pending reminders whose scheduled_for is at most `withinHours` away
 *  (default: end of today). Includes joins to customer + template. */
/**
 * List reminders that still need sending TODAY.
 *   • status = 'pending'  → already-sent reminders never appear (they flip to
 *     'sent' via markReminderSent and drop out automatically).
 *   • scheduled_for < start-of-tomorrow → only today's (and any overdue) ones;
 *     reminders scheduled for a future date stay hidden until that date.
 * So the popup/bell only ever surfaces un-sent reminders due today.
 */
export async function listDueReminders(pharmacyId: string): Promise<DueReminder[]> {
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const { data, error } = await supabase
    .from('crm_scheduled_reminders')
    .select(`
      id, scheduled_for, status, variables, template_id, customer_id,
      customer:crm_customers!inner(id, name, phone, whatsapp_opted_in),
      template:crm_templates!inner(id, name, body, language)
    `)
    .eq('pharmacy_id', pharmacyId)
    .eq('status', 'pending')
    .lt('scheduled_for', startOfTomorrow)
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
