/**
 * Vercel Serverless Function — POST /api/email/reset-password
 * Sends a secure, branded password reset email via Resend and Supabase.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { getResetPasswordEmailHtml } from './template';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface ResetRequestBody {
  email: string;
  redirectTo?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, redirectTo } = (req.body || {}) as ResetRequestBody;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const targetOrigin = redirectTo || process.env.VITE_APP_URL || 'https://connect.medstocksy.in';
  const resetRedirect = `${targetOrigin.replace(/\/$/, '')}/reset-password`;

  try {
    // 1. Generate magic recovery link using Supabase Admin API
    if (SERVICE_KEY) {
      const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: cleanEmail,
        options: { redirectTo: resetRedirect },
      });

      if (!error && data?.properties?.action_link) {
        const actionLink = data.properties.action_link;
        const html = getResetPasswordEmailHtml({ resetUrl: actionLink });
        const fromAddress = process.env.EMAIL_FROM || 'Medstocksy Connect <team@no-reply.medstocksy.in>';

        if (resend) {
          const sendResult = await resend.emails.send({
            from: fromAddress,
            to: [cleanEmail],
            subject: 'Reset your Medstocksy Connect password',
            html,
          });

          return res.status(200).json({ success: true, method: 'direct_resend', id: sendResult.data?.id });
        } else {
          console.warn('[email/reset-password] RESEND_API_KEY is not set');
        }
      } else if (error) {
        console.warn('[email/reset-password] User not found or link generation skipped:', error.message);
      }
    }

    // 2. Anti-enumeration: always return 200 success so user exists check cannot be abused
    return res.status(200).json({ success: true, method: 'noop_anti_enumeration' });
  } catch (err: unknown) {
    console.error('[email/reset-password] Error:', err);
    // Anti-enumeration: still return 200 to prevent leaking email existence
    return res.status(200).json({ success: true });
  }
}
