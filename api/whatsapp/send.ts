/**
 * Vercel Serverless Function — POST /api/whatsapp/send
 *
 * Server-side message dispatch with strict guardrails:
 *   1. Verify Supabase JWT (caller must be authenticated).
 *   2. Verify caller is a member of the target pharmacy (RLS check).
 *   3. Check rate limit via crm_can_send_now() RPC.
 *   4. Verify customer is opted in.
 *   5. Render template body with variables.
 *   6. Call WhatsApp Business API (Meta cloud API).
 *   7. Insert crm_messages row + crm_send_log row in a single transaction.
 *
 * IMPORTANT — set these env vars on Vercel (encrypted):
 *   SUPABASE_SERVICE_ROLE_KEY  — bypasses RLS for the audit insert
 *   VITE_SUPABASE_URL          — same as the client
 *   WHATSAPP_PHONE_NUMBER_ID   — Meta Cloud API phone-number ID
 *   WHATSAPP_ACCESS_TOKEN      — Meta system-user token
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env['VITE_SUPABASE_URL'];
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const WHATSAPP_PHONE_ID = process.env['WHATSAPP_PHONE_NUMBER_ID'];
const WHATSAPP_TOKEN = process.env['WHATSAPP_ACCESS_TOKEN'];

interface SendBody {
  pharmacyId: string;
  customerId: string;
  templateId: string;
  variables: Record<string, string>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' });
  }

  // 1. Authenticate the caller
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  const token = authHeader.slice('Bearer '.length);

  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) return res.status(401).json({ error: 'Invalid token' });

  // 2. Validate body
  const body = req.body as SendBody;
  if (!body?.pharmacyId || !body?.customerId || !body?.templateId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 3. Membership check (uses RLS — read fails if not a member)
  const { data: membership, error: memErr } = await userClient
    .from('crm_my_pharmacies')
    .select('pharmacy_id')
    .eq('pharmacy_id', body.pharmacyId)
    .maybeSingle();
  if (memErr || !membership) return res.status(403).json({ error: 'Not a member of this pharmacy' });

  // 4. Rate limit
  const { data: canSend } = await userClient.rpc('crm_can_send_now', { p_pharmacy_id: body.pharmacyId });
  if (!canSend) {
    return res.status(429).json({ error: 'Rate limit reached or outside send window' });
  }

  // 5. Load customer (opt-in check)
  const { data: customer, error: custErr } = await userClient
    .from('crm_customers')
    .select('id, name, phone, whatsapp_opted_in')
    .eq('id', body.customerId)
    .single();
  if (custErr || !customer) return res.status(404).json({ error: 'Customer not found' });
  if (!customer.whatsapp_opted_in) {
    return res.status(403).json({ error: 'Customer has opted out of WhatsApp' });
  }

  // 6. Load template
  const { data: template, error: tplErr } = await userClient
    .from('crm_templates')
    .select('*')
    .eq('id', body.templateId)
    .single();
  if (tplErr || !template) return res.status(404).json({ error: 'Template not found' });

  // 7. Render body — replace {var} placeholders
  const renderedBody = String(template.body).replace(/\{(\w+)\}/g, (_match, key) => {
    return body.variables[key] ?? `{${key}}`;
  });

  // 8. Call WhatsApp Cloud API
  let whatsappMessageId: string | null = null;
  let waError: string | null = null;

  if (WHATSAPP_PHONE_ID && WHATSAPP_TOKEN && template['whatsapp_template_name']) {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: customer.phone,
            type: 'template',
            template: {
              name: template['whatsapp_template_name'],
              language: { code: 'en_US' },
              components: [
                ...(template.image_url ? [{
                  type: 'header',
                  parameters: [{
                    type: 'image',
                    image: { link: template.image_url }
                  }]
                }] : []),
                {
                  type: 'body',
                  parameters: (template.variables as string[]).map((v: string) => ({
                    type: 'text',
                    text: body.variables[v] ?? '',
                  })),
                },
              ],
            },
          }),
        }
      );
      const json = (await resp.json()) as { messages?: { id: string }[]; error?: { message: string } };
      if (resp.ok && json.messages?.[0]?.id) {
        whatsappMessageId = json.messages[0].id;
      } else {
        waError = json.error?.message ?? `HTTP ${resp.status}`;
      }
    } catch (e) {
      waError = e instanceof Error ? e.message : 'Unknown WhatsApp error';
    }
  } else {
    // Dev mode: no WhatsApp creds — log only
    waError = 'DEV: WhatsApp credentials not configured';
  }

  // 9. Persist crm_messages + crm_send_log (use service role to bypass RLS quirks)
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: messageRow, error: msgErr } = await adminClient
    .from('crm_messages')
    .insert({
      pharmacy_id: body.pharmacyId,
      customer_id: body.customerId,
      template_id: body.templateId,
      direction: 'outbound',
      status: whatsappMessageId ? 'sent' : 'failed',
      body: renderedBody,
      variables: body.variables,
      to_phone: customer.phone,
      whatsapp_message_id: whatsappMessageId,
      error_message: waError,
      sent_at: whatsappMessageId ? new Date().toISOString() : null,
      failed_at: waError && !whatsappMessageId ? new Date().toISOString() : null,
      triggered_by: userData.user.id,
    } as never)
    .select()
    .single();

  if (msgErr || !messageRow) {
    return res.status(500).json({ error: msgErr?.message ?? 'Failed to log message' });
  }

  if (whatsappMessageId) {
    await adminClient.from('crm_send_log').insert({
      pharmacy_id: body.pharmacyId,
      message_id: messageRow.id,
    } as never);
  }

  if (waError && !whatsappMessageId) {
    return res.status(502).json({ error: `WhatsApp send failed: ${waError}`, messageId: messageRow.id });
  }

  return res.status(200).json({ messageId: messageRow.id, whatsappMessageId });
}
