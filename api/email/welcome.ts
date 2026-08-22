/**
 * Vercel Serverless Function — POST /api/email/welcome
 * Sends a branded welcome email to newly registered Medstocksy Connect users.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

import { getWelcomeEmailHtml } from './template.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

interface WelcomeRequestBody {
  email: string;
  fullName?: string;
  pharmacyName?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, fullName, pharmacyName } = (req.body || {}) as WelcomeRequestBody;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const emailHtml = getWelcomeEmailHtml({ fullName, pharmacyName });

  const fromAddress = process.env.EMAIL_FROM || 'Medstocksy Connect <team@no-reply.medstocksy.in>';

  try {
    if (!resend) {
      console.warn('[email/welcome] RESEND_API_KEY is not configured');
      return res.status(200).json({ success: true, warning: 'Email service not configured' });
    }

    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [email],
      subject: 'Welcome to Medstocksy Connect — Your Pharmacy CRM is Ready',
      html: emailHtml,
    });

    if (error) {
      console.error('[email/welcome] Resend send failed:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true, id: data?.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[email/welcome] Unexpected error:', err);
    return res.status(500).json({ error: message });
  }
}
