import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from 'react-email';

interface MedstocksyResetPasswordEmailProps {
  fullName?: string;
  resetUrl?: string;
}

export const MedstocksyResetPasswordEmail = ({
  fullName = 'Doctor / Pharmacist',
  resetUrl = 'https://connect.medstocksy.in/reset-password',
}: MedstocksyResetPasswordEmailProps) => {
  const firstName = fullName?.split(' ')[0] || 'there';

  return (
    <Html>
      <Head />
      <Preview>Reset your Medstocksy Connect password</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header & Logo */}
          <Section style={headerSection}>
            <Img
              src="https://raw.githubusercontent.com/Arham0003/Medstocksy-Connect/main/public/pwa-512x512.png"
              width="56"
              height="56"
              alt="Medstocksy Logo"
              style={logo}
            />
            <Heading style={brandTitle}>Medstocksy Connect</Heading>
            <Text style={brandSubtitle}>Password Reset Request</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Text style={greeting}>Hello {firstName}, 👋</Text>
            <Text style={paragraph}>
              We received a request to reset your password for your <strong>Medstocksy Connect</strong> account. Click the button below to choose a new password:
            </Text>

            {/* CTA Button */}
            <Section style={ctaSection}>
              <Button style={ctaButton} href={resetUrl}>
                Reset My Password
              </Button>
            </Section>

            <Section style={securityNote}>
              <Text style={securityTitle}>🔒 Security Notice</Text>
              <Text style={securityText}>
                • This link will expire in 60 minutes for your security.
              </Text>
              <Text style={securityText}>
                • If you did not request a password reset, you can safely ignore this email — your account remains completely secure.
              </Text>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              © {new Date().getFullYear()} Medstocksy Connect · Built for Modern Pharmacies
            </Text>
            <Text style={footerMuted}>
              This is an automated security notification regarding your Medstocksy Connect account.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default MedstocksyResetPasswordEmail;

// ─── Styles ──────────────────────────────────────────────────────────────────
const main = {
  backgroundColor: '#f8fafc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  padding: '32px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '32px 28px',
  borderRadius: '12px',
  border: '1px solid #e2e8f0',
  maxWidth: '560px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
};

const headerSection = {
  textAlign: 'center' as const,
  marginBottom: '20px',
};

const logo = {
  margin: '0 auto 12px auto',
  display: 'block',
  borderRadius: '10px',
};

const brandTitle = {
  fontSize: '22px',
  fontWeight: '700',
  color: '#4338ca',
  margin: '0 0 4px 0',
  letterSpacing: '-0.02em',
};

const brandSubtitle = {
  fontSize: '13px',
  color: '#64748b',
  margin: '0',
};

const divider = {
  borderColor: '#f1f5f9',
  margin: '20px 0',
};

const contentSection = {
  padding: '0 4px',
};

const greeting = {
  fontSize: '18px',
  fontWeight: '600',
  color: '#1e293b',
  margin: '0 0 12px 0',
};

const paragraph = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#334155',
  margin: '0 0 16px 0',
};

const ctaSection = {
  textAlign: 'center' as const,
  margin: '28px 0',
};

const ctaButton = {
  backgroundColor: '#6366f1',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 28px',
  boxShadow: '0 2px 4px rgba(99, 102, 241, 0.25)',
};

const securityNote = {
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '14px 16px',
  margin: '20px 0 0 0',
};

const securityTitle = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#475569',
  margin: '0 0 6px 0',
};

const securityText = {
  fontSize: '12px',
  lineHeight: '1.5',
  color: '#64748b',
  margin: '4px 0',
};

const footerSection = {
  textAlign: 'center' as const,
};

const footerText = {
  fontSize: '12px',
  color: '#64748b',
  margin: '0 0 4px 0',
};

const footerMuted = {
  fontSize: '11px',
  color: '#94a3b8',
  margin: '0',
};
