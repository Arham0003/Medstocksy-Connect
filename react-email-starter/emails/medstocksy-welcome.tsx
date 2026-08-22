import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'react-email';

interface MedstocksyWelcomeEmailProps {
  fullName?: string;
  pharmacyName?: string;
  loginUrl?: string;
}

const defaultUrl = 'https://connect.medstocksy.in';

export const MedstocksyWelcomeEmail = ({
  fullName = 'Doctor / Pharmacist',
  pharmacyName,
  loginUrl = defaultUrl,
}: MedstocksyWelcomeEmailProps) => {
  const firstName = fullName?.split(' ')[0] || 'there';

  return (
    <Html>
      <Head />
      <Preview>Welcome to Medstocksy Connect — Your Pharmacy CRM is Ready</Preview>
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
            <Text style={brandSubtitle}>Intelligent Patient Relations & Refill CRM</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Text style={greeting}>Hello {firstName}, 👋</Text>
            <Text style={paragraph}>
              Welcome to <strong>Medstocksy Connect</strong>! Your pharmacy workspace {pharmacyName ? `for "${pharmacyName}" ` : ''}is officially set up and ready to help you grow your pharmacy business and retain your patients.
            </Text>

            <Section style={featureCard}>
              <Text style={featureTitle}>🚀 What you can do right now:</Text>
              <Text style={featureItem}>
                💬 <strong>Automated WhatsApp Reminders:</strong> Keep chronic patients adhering to their prescriptions with zero friction.
              </Text>
              <Text style={featureItem}>
                👥 <strong>Smart Customer Profiles:</strong> Centralize bills, prescription attachments, and refill timelines in one place.
              </Text>
              <Text style={featureItem}>
                🎯 <strong>Targeted Campaigns:</strong> Run tailored promotions, health checkup alerts, and festival greetings to loyal customers.
              </Text>
            </Section>

            {/* CTA Button */}
            <Section style={ctaSection}>
              <Button style={ctaButton} href={loginUrl}>
                Open Medstocksy Connect
              </Button>
            </Section>

            <Text style={subtext}>
              Need any help setting up your pharmacy details, WhatsApp templates, or importing customer data? Simply reply to this email — our team is here for you.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              © {new Date().getFullYear()} Medstocksy Connect · Built for Modern Pharmacies
            </Text>
            <Text style={footerMuted}>
              You received this email because you created an account on Medstocksy Connect.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default MedstocksyWelcomeEmail;

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

const featureCard = {
  backgroundColor: '#f8faff',
  border: '1px solid #e0e7ff',
  borderRadius: '8px',
  padding: '16px 18px',
  margin: '20px 0',
};

const featureTitle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#3730a3',
  margin: '0 0 10px 0',
};

const featureItem = {
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#475569',
  margin: '6px 0',
};

const ctaSection = {
  textAlign: 'center' as const,
  margin: '28px 0 20px 0',
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

const subtext = {
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#64748b',
  margin: '16px 0 0 0',
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
