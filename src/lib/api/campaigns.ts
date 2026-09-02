/**
 * Campaign send helpers — resolve a segment's opted-in customers and finalize
 * a campaign once the messages have been dispatched (via the wa.me/ queue or
 * the openWA bot). Recipient delivery rows are written to
 * crm_campaign_recipients for the per-customer audit.
 */
import { supabase } from '@/lib/supabase';

export interface CampaignRecipient {
  id: string;
  name: string;
  phone: string;
}

/** Resolve the opted-in customers for a segment. Opt-outs are always excluded
 *  (Rule 9). Mirrors the recipient-count logic in CampaignDialog but returns
 *  the actual rows needed to send. */
export async function resolveSegmentCustomers(
  pharmacyId: string,
  segmentKey: string
): Promise<CampaignRecipient[]> {
  if (segmentKey === 'all') {
    const { data, error } = await supabase
      .from('crm_customers')
      .select('id, name, phone')
      .eq('pharmacy_id', pharmacyId)
      .eq('whatsapp_opted_in', true)
      .not('phone', 'is', null)
      .order('name');
    if (error) throw new Error(error.message);
    const recipients = ((data ?? []) as unknown) as CampaignRecipient[];
    return recipients.filter((r) => r.phone && r.phone.trim().length > 0);
  }

  // Chronic = manual tag; everything else = derived auto-tag view.
  let ids: string[] = [];
  if (segmentKey === 'chronic') {
    const { data: tags, error } = await supabase
      .from('crm_tags')
      .select('customer_id')
      .eq('pharmacy_id', pharmacyId)
      .eq('tag_key', 'chronic');
    if (error) throw new Error(error.message);
    ids = ((tags ?? []) as unknown as { customer_id: string }[]).map((r) => r.customer_id);
  } else {
    const { data: rows, error } = await supabase
      .from('crm_customer_auto_tags')
      .select('customer_id')
      .eq('pharmacy_id', pharmacyId)
      .eq('tag', segmentKey);
    if (error) throw new Error(error.message);
    ids = ((rows ?? []) as unknown as { customer_id: string }[]).map((r) => r.customer_id);
  }
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('crm_customers')
    .select('id, name, phone')
    .in('id', ids)
    .eq('whatsapp_opted_in', true)
    .not('phone', 'is', null)
    .order('name');
  if (error) throw new Error(error.message);
  const recipients = ((data ?? []) as unknown) as CampaignRecipient[];
  return recipients.filter((r) => r.phone && r.phone.trim().length > 0);
}

/** Mark a campaign as actively sending. */
export async function markCampaignSending(campaignId: string, total: number): Promise<void> {
  const { error } = await supabase
    .from('crm_campaigns')
    .update({ status: 'sending', total_recipients: total } as never)
    .eq('id', campaignId);
  if (error) throw new Error(error.message);
}

/** Record one recipient's delivery + (best-effort) link the message. */
export async function recordCampaignRecipient(args: {
  campaignId: string;
  customerId: string;
  messageId?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('crm_campaign_recipients')
    .upsert({
      campaign_id: args.campaignId,
      customer_id: args.customerId,
      status: 'sent',
      message_id: args.messageId ?? null,
      sent_at: new Date().toISOString(),
    } as never, { onConflict: 'campaign_id,customer_id' });
  if (error) throw new Error(error.message);
}

/** Finalize a campaign after the queue completes. */
export async function finalizeCampaign(args: {
  campaignId: string;
  sentCount: number;
  totalRecipients: number;
}): Promise<void> {
  const { error } = await supabase
    .from('crm_campaigns')
    .update({
      status: 'sent',
      sent_count: args.sentCount,
      total_recipients: args.totalRecipients,
    } as never)
    .eq('id', args.campaignId);
  if (error) throw new Error(error.message);
}

/**
 * Hard-delete a campaign. ON DELETE CASCADE in the schema removes the
 * related crm_campaign_recipients and crm_messages.campaign_id = SET NULL rows
 * automatically — no manual cleanup needed.
 */
export async function deleteCampaign(campaignId: string): Promise<void> {
  const { error } = await supabase
    .from('crm_campaigns')
    .delete()
    .eq('id', campaignId);
  if (error) throw new Error(error.message);
}

/** Fetch real variables for a recipient so we don't use mock SAMPLE_VARS. */
export async function fetchCustomerCampaignVars(
  pharmacyId: string,
  customerId: string,
  customerName: string
): Promise<Record<string, string>> {
  let amount = '';
  let medicine = '';

  try {
    // 1. Fetch pharmacy details
    const { data: pharmacyData } = await supabase
      .from('crm_pharmacies')
      .select('name, phone')
      .eq('id', pharmacyId)
      .maybeSingle();
    const pharmacy = pharmacyData as { name?: string; phone?: string | null } | null;

    // 2. Fetch latest purchase amount using exact customer_id
    const { data: saleData } = await supabase
      .from('crm_customer_sales')
      .select('bill_amount')
      .eq('customer_id', customerId)
      .order('sold_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestSale = saleData as { bill_amount?: number | null } | null;
      
    if (latestSale && latestSale.bill_amount) {
      amount = `₹${latestSale.bill_amount}`;
    }

    // 3. Fetch latest prescription medicine using exact customer_id
    const { data: rxData } = await supabase
      .from('crm_prescriptions')
      .select('id')
      .eq('customer_id', customerId)
      .order('prescription_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestRx = rxData as { id: string } | null;

    if (latestRx) {
      const { data: medData } = await supabase
        .from('crm_prescription_medicines')
        .select('medicine_name')
        .eq('prescription_id', latestRx.id)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      const medRow = medData as { medicine_name: string } | null;
      if (medRow && medRow.medicine_name) {
        medicine = medRow.medicine_name;
      }
    }

    return {
      name: customerName,
      pharmacy_name: pharmacy?.name ?? 'Your pharmacy',
      pharmacy_phone: pharmacy?.phone ?? '',
      amount,
      medicine,
    };
  } catch (err) {
    console.error('[fetchCustomerCampaignVars] failed:', err);
    return { name: customerName };
  }
}
