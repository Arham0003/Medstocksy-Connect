import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    hasResendKey: !!process.env.RESEND_API_KEY,
    resendKeyPrefix: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.substring(0, 4) : null,
    hasServiceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasSupabaseUrl: !!process.env.VITE_SUPABASE_URL,
    emailFrom: process.env.EMAIL_FROM || 'default (Medstocksy Connect <team@no-reply.medstocksy.in>)',
    nodeEnv: process.env.NODE_ENV,
  });
}
