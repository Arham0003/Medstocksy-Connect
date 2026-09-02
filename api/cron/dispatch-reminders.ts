/**
 * Vercel Cron — GET /api/cron/dispatch-reminders
 *
 * Fires the scheduled reminders that `crm_scheduled_reminders` has been
 * accumulating. Before this existed, `scheduled_for` was decorative: rows were
 * created on prescription save and then sat at status='pending' until a staff
 * member manually pressed Send, which is the gap the audit called the single
 * biggest difference between the product promise and reality (§8).
 *
 * Guardrails, in order — each one skips rather than fails the whole run:
 *   1. Caller must present CRON_SECRET.
 *   2. Reminder must be pending and actually due.
 *   3. Customer must still be opted in to WhatsApp.
 *   4. Pharmacy must pass crm_can_send_now() — hourly cap AND send window.
 *   5. Pharmacy must have a WABA-capable template.
 *
 * IMPORTANT — this can only auto-send for pharmacies on the official
 * WhatsApp Cloud API. The free click-to-chat flow needs a human to press send
 * in WhatsApp, so those reminders stay pending for the "Send all today" queue
 * on /reminders. Reminders skipped for that reason are counted as `skipped`,
 * never marked failed.
 *
 * Env vars (Vercel, encrypted):
 *   CRON_SECRET                — shared secret; Vercel sends it as a Bearer token
 *   VITE_SUPABASE_URL          — same as the client
 *   SUPABASE_SERVICE_ROLE_KEY  — cross-tenant read/write; never exposed to browsers
 *   WHATSAPP_PHONE_NUMBER_ID   — Meta Cloud API phone-number ID
 *   WHATSAPP_ACCESS_TOKEN      — Meta system-user token
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env['VITE_SUPABASE_URL'];
const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const CRON_SECRET = process.env['CRON_SECRET'];
const WHATSAPP_PHONE_ID = process.env['WHATSAPP_PHONE_NUMBER_ID'];
const WHATSAPP_TOKEN = process.env['WHATSAPP_ACCESS_TOKEN'];

/** Cap per invocation. Keeps the function inside its maxDuration and bounds
 *  the blast radius if something is wrong — the next tick picks up the rest. */
const BATCH_LIMIT = 100;

interface DueReminder {
  id: string;
  pharmacy_id: string;
  customer_id: string;
  template_id: string | null;
  scheduled_for: string;
  variables: Record<string, string> | null;
  customer: {
    id: string; name: string; phone: string; whatsapp_opted_in: boolean;
  } | null;
  template: {
    id: string; body: string; image_url: string | null;
    variables: string[] | null; whatsapp_template_name: string | null;
  } | null;
}

function renderTemplate(body: string, vars: Record<string, string> | null): string {
  return body.replace(/\{(\w+)\}/g, (_m, key: string) => vars?.[key] ?? `{${key}}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without this the
  // endpoint is a public, unauthenticated bulk-send trigger.
  if (!CRON_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: CRON_SECRET not set' });
  }
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = new Date().toISOString();
  const counts = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const detail: Record<string, { sent: number; failed: number; skipped: number }> = {};

  const bump = (pharmacyId: string, key: 'sent' | 'failed' | 'skipped') => {
    detail[pharmacyId] ??= { sent: 0, failed: 0, skipped: 0 };
    detail[pharmacyId][key] += 1;
    counts[key] += 1;
  };

  try {
    const { data, error } = await admin
      .from('crm_scheduled_reminders')
      .select(
        'id, pharmacy_id, customer_id, template_id, scheduled_for, variables,' +
        'customer:crm_customers(id, name, phone, whatsapp_opted_in),' +
        'template:crm_templates(id, body, image_url, variables, whatsapp_template_name)'
      )
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) throw new Error(error.message);
    const due = (data ?? []) as unknown as DueReminder[];

    // crm_can_send_now() is per-pharmacy and covers both the hourly cap and
    // the configured send window. Cache it per run so a pharmacy with 40 due
    // reminders costs one RPC instead of 40.
    const sendable = new Map<string, boolean>();
    const canSend = async (pharmacyId: string): Promise<boolean> => {
      const cached = sendable.get(pharmacyId);
      if (cached !== undefined) return cached;
      const { data: ok } = await admin.rpc('crm_can_send_now', { p_pharmacy_id: pharmacyId });
      const allowed = Boolean(ok);
      sendable.set(pharmacyId, allowed);
      return allowed;
    };

    for (const rem of due) {
      counts.processed += 1;

      if (!rem.customer || !rem.customer.whatsapp_opted_in || !rem.customer.phone) {
        // Opted out or unreachable. Cancel rather than leave it pending
        // forever — it will never become sendable.
        await admin
          .from('crm_scheduled_reminders')
          .update({ status: 'cancelled' } as never)
          .eq('id', rem.id);
        bump(rem.pharmacy_id, 'skipped');
        continue;
      }

      if (!(await canSend(rem.pharmacy_id))) {
        // Outside the send window or over the hourly cap. Leave pending — a
        // later tick inside the window will pick it up.
        bump(rem.pharmacy_id, 'skipped');
        continue;
      }

      const waTemplate = rem.template?.whatsapp_template_name;
      if (!WHATSAPP_PHONE_ID || !WHATSAPP_TOKEN || !waTemplate) {
        // Click-to-chat-only pharmacy. Not an error: staff will send these
        // from /reminders. Left pending on purpose.
        bump(rem.pharmacy_id, 'skipped');
        continue;
      }

      const renderedBody = renderTemplate(rem.template!.body, rem.variables);
      let whatsappMessageId: string | null = null;
      let waError: string | null = null;

      try {
        const resp = await fetch(
          `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: rem.customer.phone,
              type: 'template',
              template: {
                name: waTemplate,
                language: { code: 'en_US' },
                components: [
                  ...(rem.template!.image_url
                    ? [{
                        type: 'header',
                        parameters: [{ type: 'image', image: { link: rem.template!.image_url } }],
                      }]
                    : []),
                  {
                    type: 'body',
                    parameters: (rem.template!.variables ?? []).map((v) => ({
                      type: 'text',
                      text: rem.variables?.[v] ?? '',
                    })),
                  },
                ],
              },
            }),
          }
        );
        const json = (await resp.json()) as {
          messages?: { id: string }[]; error?: { message: string };
        };
        if (resp.ok && json.messages?.[0]?.id) {
          whatsappMessageId = json.messages[0].id;
        } else {
          waError = json.error?.message ?? `HTTP ${resp.status}`;
        }
      } catch (e) {
        waError = e instanceof Error ? e.message : 'Unknown WhatsApp error';
      }

      await recordOutcome(admin, rem, renderedBody, whatsappMessageId, waError);

      if (whatsappMessageId) {
        bump(rem.pharmacy_id, 'sent');
        // A successful send consumes rate-limit budget, so re-check before
        // the next reminder for this pharmacy instead of trusting the cache.
        sendable.delete(rem.pharmacy_id);
      } else {
        bump(rem.pharmacy_id, 'failed');
      }
    }

    await admin.from('crm_cron_log').insert({
      job: 'dispatch-reminders',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
      ...counts,
      detail,
    } as never);

    return res.status(200).json({ ok: true, ...counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    await admin.from('crm_cron_log').insert({
      job: 'dispatch-reminders',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      ...counts,
      detail,
      error_message: message,
    } as never);
    return res.status(500).json({ ok: false, error: message, ...counts });
  }
}

/** Write the message row, bump the rate-limit log, and move the reminder off
 *  'pending'. Kept together so a reminder can never be marked sent without a
 *  corresponding crm_messages row for the activity timeline. */
async function recordOutcome(
  admin: SupabaseClient,
  rem: DueReminder,
  renderedBody: string,
  whatsappMessageId: string | null,
  waError: string | null
): Promise<void> {
  const now = new Date().toISOString();

  const { data: messageRow } = await admin
    .from('crm_messages')
    .insert({
      pharmacy_id: rem.pharmacy_id,
      customer_id: rem.customer_id,
      template_id: rem.template_id,
      direction: 'outbound',
      status: whatsappMessageId ? 'sent' : 'failed',
      body: renderedBody,
      variables: rem.variables ?? {},
      to_phone: rem.customer?.phone ?? null,
      whatsapp_message_id: whatsappMessageId,
      error_message: waError,
      sent_at: whatsappMessageId ? now : null,
      failed_at: whatsappMessageId ? null : now,
    } as never)
    .select('id')
    .single();

  const messageId = (messageRow as { id: string } | null)?.id ?? null;

  if (whatsappMessageId && messageId) {
    await admin.from('crm_send_log').insert({
      pharmacy_id: rem.pharmacy_id,
      message_id: messageId,
    } as never);
  }

  await admin
    .from('crm_scheduled_reminders')
    .update(
      (whatsappMessageId
        ? { status: 'sent', sent_at: now, message_id: messageId }
        : { status: 'failed', error_message: waError }) as never
    )
    .eq('id', rem.id);
}
