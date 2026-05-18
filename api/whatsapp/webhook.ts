/**
 * WhatsApp Business API webhook — Meta calls this for:
 *   - Inbound messages (replies, "STOP" opt-outs)
 *   - Delivery receipts (sent → delivered → read)
 *   - Status updates (failed, deleted)
 *
 * Configure on Meta dashboard:
 *   Callback URL:    https://<your-domain>/api/whatsapp/webhook
 *   Verify token:    process.env.WHATSAPP_VERIFY_TOKEN (any string)
 *   Subscribe to:    messages
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env['VITE_SUPABASE_URL'];
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const VERIFY_TOKEN = process.env['WHATSAPP_VERIFY_TOKEN'];

interface MessageStatusUpdate {
  id: string;             // WABA message ID
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient_id: string;
  errors?: { code: number; title: string }[];
}

interface InboundMessage {
  from: string;           // sender phone E.164
  id: string;             // WABA message ID
  text?: { body: string };
  type: 'text' | 'button' | 'interactive';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ─── GET: Verification handshake (Meta calls once when you save the webhook) ───
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN && typeof challenge === 'string') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // ─── POST: Event payload ───
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = req.body as {
    entry?: { changes?: { value?: { statuses?: MessageStatusUpdate[]; messages?: InboundMessage[] } }[] }[];
  };

  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Status updates
      for (const status of value.statuses ?? []) {
        const updates: Record<string, unknown> = { status: status.status };
        if (status.status === 'delivered') updates['delivered_at'] = new Date().toISOString();
        if (status.status === 'read') updates['read_at'] = new Date().toISOString();
        if (status.status === 'failed') {
          updates['failed_at'] = new Date().toISOString();
          updates['error_code'] = status.errors?.[0]?.code?.toString() ?? null;
          updates['error_message'] = status.errors?.[0]?.title ?? null;
        }
        await supabase
          .from('crm_messages')
          .update(updates as never)
          .eq('whatsapp_message_id', status.id);
      }

      // Inbound messages (replies + opt-out)
      for (const msg of value.messages ?? []) {
        const phone = '+' + msg.from;
        const text = msg.text?.body?.trim().toUpperCase() ?? '';

        // Opt-out detection
        if (['STOP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT'].includes(text)) {
          await supabase
            .from('crm_customers')
            .update({
              whatsapp_opted_in: false,
              whatsapp_opted_out_at: new Date().toISOString(),
              whatsapp_opted_out_reason: 'User replied STOP',
            } as never)
            .eq('phone', phone);
        }

        // Find the customer this message belongs to (any pharmacy with this phone)
        const { data: customers } = await supabase
          .from('crm_customers')
          .select('id, pharmacy_id')
          .eq('phone', phone);

        for (const c of customers ?? []) {
          await supabase.from('crm_messages').insert({
            pharmacy_id: c.pharmacy_id,
            customer_id: c.id,
            direction: 'inbound',
            status: 'delivered',
            body: msg.text?.body ?? '',
            to_phone: phone,
            from_phone: phone,
            whatsapp_message_id: msg.id,
          } as never);
        }
      }
    }
  }

  return res.status(200).json({ received: true });
}
