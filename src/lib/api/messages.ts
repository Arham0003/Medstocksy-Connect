import { supabase } from '@/lib/supabase';

export interface WhatsAppHealth {
  pharmacy_id: string;
  rate_limit_per_hour: number;
  sends_last_hour: number;
  bounce_rate_24h: number | null;
  opt_outs_30d: number;
  total_customers: number;
  send_window_start: string;
  send_window_end: string;
}

export async function getWhatsAppHealth(pharmacyId: string): Promise<WhatsAppHealth | null> {
  const { data, error } = await supabase
    .from('crm_whatsapp_health')
    .select('*')
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle();
  if (error) throw error;
  return (data as WhatsAppHealth | null) ?? null;
}

export async function canSendNow(pharmacyId: string): Promise<boolean> {
  // Cast: hand-typed Database shim doesn't fully model RPC arg types.
  // Replace with `npm run supabase:types` output once the migration is applied.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc('crm_can_send_now', { p_pharmacy_id: pharmacyId });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export interface SendMessagePayload {
  pharmacyId: string;
  customerId: string;
  templateId: string;
  variables: Record<string, string>;
}

/**
 * Client-side send: posts to the Vercel serverless function which:
 *   1. Validates rate limit + opt-in status
 *   2. Renders the template
 *   3. Calls the WhatsApp Business API
 *   4. Inserts crm_messages row with the WABA message ID
 *   5. Logs to crm_send_log for the rate-limit window
 */
export async function sendMessage(payload: SendMessagePayload): Promise<{ messageId: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch('/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Send failed: HTTP ${res.status}`);
  }

  return (await res.json()) as { messageId: string };
}
