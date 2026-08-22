/**
 * Client helper to trigger welcome email upon account creation.
 */
export async function sendWelcomeEmail(payload: {
  email: string;
  fullName?: string;
  pharmacyName?: string;
}): Promise<void> {
  // ponytail: fire-and-forget; never block the UI or fail signup if email delivery has hiccups
  try {
    await fetch('/api/email/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[email] Failed to send welcome email:', err);
  }
}

/**
 * Client helper to trigger password reset email.
 */
export async function sendResetPasswordEmail(email: string): Promise<boolean> {
  try {
    const res = await fetch('/api/email/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: window.location.origin }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[email] Failed to send reset email:', err);
    return false;
  }
}

