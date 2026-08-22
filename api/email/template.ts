/**
 * Reusable HTML template for Medstocksy Connect Welcome Email.
 */
export function getWelcomeEmailHtml(args: {
  fullName?: string;
  pharmacyName?: string;
  loginUrl?: string;
}): string {
  const firstName = args.fullName?.trim().split(' ')[0] || 'there';
  const loginUrl = args.loginUrl || 'https://connect.medstocksy.in';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Welcome to Medstocksy Connect</title>
</head>
<body style="background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 32px 16px; margin: 0;">
  <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" style="max-width: 560px; background-color: #ffffff; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <tr>
      <td align="center" style="padding-bottom: 20px;">
        <img src="https://raw.githubusercontent.com/Arham0003/Medstocksy-Connect/main/public/pwa-512x512.png" width="56" height="56" alt="Medstocksy Logo" style="display: block; margin-bottom: 12px; border-radius: 10px;" />
        <h1 style="font-size: 22px; font-weight: 700; color: #4338ca; margin: 0 0 4px 0; letter-spacing: -0.02em;">Medstocksy Connect</h1>
        <p style="font-size: 13px; color: #64748b; margin: 0;">Intelligent Patient Relations &amp; Refill CRM</p>
      </td>
    </tr>
    <tr>
      <td>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
      </td>
    </tr>
    <tr>
      <td style="padding: 8px 4px;">
        <h2 style="font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 12px 0;">Hello ${firstName}, 👋</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">
          Welcome to <strong>Medstocksy Connect</strong>! Your pharmacy workspace ${args.pharmacyName ? `for "<strong>${args.pharmacyName}</strong>" ` : ''}is officially set up and ready to help you grow your pharmacy business and retain your patients.
        </p>

        <div style="background-color: #f8faff; border: 1px solid #e0e7ff; border-radius: 8px; padding: 16px 18px; margin: 20px 0;">
          <p style="font-size: 14px; font-weight: 600; color: #3730a3; margin: 0 0 10px 0;">🚀 What you can do right now:</p>
          <p style="font-size: 13px; line-height: 1.5; color: #475569; margin: 6px 0;">
            💬 <strong>Automated WhatsApp Reminders:</strong> Keep chronic patients adhering to their prescriptions with zero friction.
          </p>
          <p style="font-size: 13px; line-height: 1.5; color: #475569; margin: 6px 0;">
            👥 <strong>Smart Customer Profiles:</strong> Centralize bills, prescription attachments, and refill timelines in one place.
          </p>
          <p style="font-size: 13px; line-height: 1.5; color: #475569; margin: 6px 0;">
            🎯 <strong>Targeted Campaigns:</strong> Run tailored promotions, health checkup alerts, and festival greetings to loyal customers.
          </p>
        </div>

        <div style="text-align: center; margin: 28px 0 20px 0;">
          <a href="${loginUrl}" style="background-color: #6366f1; border-radius: 8px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; text-align: center; display: inline-block; padding: 12px 28px; box-shadow: 0 2px 4px rgba(99, 102, 241, 0.25);">
            Open Medstocksy Connect
          </a>
        </div>

        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 16px 0 0 0;">
          Need any help setting up your pharmacy details or WhatsApp templates? Simply reply to this email — our team is here for you.
        </p>
      </td>
    </tr>
    <tr>
      <td>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
      </td>
    </tr>
    <tr>
      <td align="center">
        <p style="font-size: 12px; color: #64748b; margin: 0 0 4px 0;">
          © ${new Date().getFullYear()} Medstocksy Connect · Built for Modern Pharmacies
        </p>
        <p style="font-size: 11px; color: #94a3b8; margin: 0;">
          You received this email because you created an account on Medstocksy Connect.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Reusable HTML template for Medstocksy Connect Password Reset Email.
 */
export function getResetPasswordEmailHtml(args: {
  fullName?: string;
  resetUrl: string;
}): string {
  const firstName = args.fullName?.trim().split(' ')[0] || 'there';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reset your Medstocksy Connect password</title>
</head>
<body style="background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 32px 16px; margin: 0;">
  <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" style="max-width: 560px; background-color: #ffffff; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <tr>
      <td align="center" style="padding-bottom: 20px;">
        <img src="https://raw.githubusercontent.com/Arham0003/Medstocksy-Connect/main/public/pwa-512x512.png" width="56" height="56" alt="Medstocksy Logo" style="display: block; margin-bottom: 12px; border-radius: 10px;" />
        <h1 style="font-size: 22px; font-weight: 700; color: #4338ca; margin: 0 0 4px 0; letter-spacing: -0.02em;">Medstocksy Connect</h1>
        <p style="font-size: 13px; color: #64748b; margin: 0;">Password Reset Request</p>
      </td>
    </tr>
    <tr>
      <td>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 16px 0;" />
      </td>
    </tr>
    <tr>
      <td style="padding: 8px 4px;">
        <h2 style="font-size: 18px; font-weight: 600; color: #1e293b; margin: 0 0 12px 0;">Hello ${firstName}, 👋</h2>
        <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 16px 0;">
          We received a request to reset your password for your <strong>Medstocksy Connect</strong> account. Click the button below to choose a new password:
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${args.resetUrl}" style="background-color: #6366f1; border-radius: 8px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; text-align: center; display: inline-block; padding: 12px 28px; box-shadow: 0 2px 4px rgba(99, 102, 241, 0.25);">
            Reset My Password
          </a>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin: 20px 0 0 0;">
          <p style="font-size: 13px; font-weight: 600; color: #475569; margin: 0 0 6px 0;">🔒 Security Notice</p>
          <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 4px 0;">
            • This link is valid for 60 minutes.
          </p>
          <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 4px 0;">
            • If you did not request this, you can safely ignore this email — your account remains completely secure.
          </p>
        </div>
      </td>
    </tr>
    <tr>
      <td>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
      </td>
    </tr>
    <tr>
      <td align="center">
        <p style="font-size: 12px; color: #64748b; margin: 0 0 4px 0;">
          © ${new Date().getFullYear()} Medstocksy Connect · Built for Modern Pharmacies
        </p>
        <p style="font-size: 11px; color: #94a3b8; margin: 0;">
          This is an automated security notification regarding your Medstocksy Connect account.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
