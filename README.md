# Medstocksy Connect (medcrm) — Customer Relations for Pharmacies

A high-performance WhatsApp-driven and email-enabled CRM that seamlessly integrates into the **Medstocksy Inventory** ecosystem at [app.medstocksy.in](https://app.medstocksy.in). Powered by single sign-on (SSO) via shared Supabase auth, intelligent Prescription OCR extraction with Gemini AI, customizable medicine refill reminders, customer segmentation, and Progressive Web App (PWA) offline capabilities.

---

## ⚙️ Stack & Architecture

| Layer | Choice | Description / Purpose |
|-------|--------|------------------------|
| **Frontend** | **React 18 + TypeScript + Vite 6** | Strict typing, code-split chunking, sub-second HMR |
| **Styling** | **Tailwind 3 + shadcn/ui** | Design tokens matching Medstocksy inventory app |
| **State & Cache** | **TanStack Query 5** + React Context | Smart invalidation, optimistic updates, auth/pharmacy state |
| **Routing** | **react-router-dom v6** | Protected routes, auth guards, deep linking for reset flows |
| **AI / OCR** | **Google Gemini AI + PDF.js** | Prescription parsing, schema extraction, medicine auto-matching |
| **Email Service** | **Resend + React Email** | Custom branded transactional templates (Welcome, Reset Password) |
| **PWA / Mobile** | **Vite PWA (Workbox)** | Offline asset caching, service worker, standalone mobile install |
| **Backend & DB** | **Supabase (PostgreSQL + RLS)** | 13+ CRM tables, RPCs, security definer views, audit triggers |
| **Serverless** | **Vercel Functions (`api/`)** | WhatsApp dispatch, webhooks, transactional email endpoints |
| **WhatsApp API** | **Meta Cloud API v21** | Direct graph API messaging with rate-limit enforcement |
| **i18n** | **Custom lightweight i18n** | English (`en`) & Hindi (`hi`) translation dictionaries |

---

## 🌟 Key Features & Recent Implementation Updates

### 1. 🔍 Schema-Driven Prescription OCR & AI Extraction
- **Gemini AI Vision & OCR Engine**: Extracts patient name, doctor, hospital, diagnosis, medicines, dosages, frequencies, and durations directly from prescription images and multi-page PDFs (`src/lib/gemini.ts`, `src/lib/ocr/fields.ts`).
- **PDF.js Client-Side Extraction**: Fast rasterization of multi-page PDFs to images in a dedicated worker thread (`src/lib/pdf/extract.ts`, `src/lib/pdf/usePdfExtraction.ts`).
- **Inventory Medicine Matcher**: Automatically maps extracted prescription medicines to inventory catalog items with confidence scoring and fallback manual assignment.

### 2. 🔐 Authentication, Reset Password & Transactional Email
- **Direct Password Reset Flow**: Dedicated `/reset-password` route supporting PKCE recovery tokens, real-time password strength validation, and secure password update via Supabase Auth (`src/pages/ResetPassword.tsx`).
- **Custom Branded Email System**: Serverless endpoints powered by Resend (`api/email/reset-password.ts`, `api/email/welcome.ts`, `api/email/template.ts`) with custom styled email templates in `react-email-starter/`.
- **Cross-Domain Recovery Handshake**: Automatic redirect and token preservation from Medstocksy authentication emails to the active client origin.

### 3. 📱 Progressive Web App (PWA) & Mobile UX
- **Full Offline Caching**: Workbox service worker caching assets, fonts, icons, and shell HTML for instant loading (`vite.config.ts`).
- **Mobile Standalone Manifest**: Custom icons (`pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png`), theme colors, and responsive drawer navigation.
- **PWA Auto-Update Prompt**: Seamless service worker update detection without hard page refreshes.

### 4. ⏰ Interactive Reminders & Action Center
- **Bulk Reminder Send Dialog**: Multi-customer selection with template preview, variable replacement, and instant WhatsApp dispatch (`src/components/crm/BulkReminderSendDialog.tsx`).
- **Reschedule Reminder Dialog**: Interactive calendar date/time picker to delay or move refill reminders (`src/components/crm/RescheduleReminderDialog.tsx`).
- **Today's Due Reminders Popup & Bell**: Header notification counter with direct one-click send and mark-completed triggers (`src/components/layout/RemindersBell.tsx`, `src/components/layout/TodayRemindersPopup.tsx`).
- **Quick Reminder & Bill Linking**: Quickly attach refill reminders directly from billing and prescription workflows (`src/components/crm/QuickReminderDialog.tsx`, `src/components/crm/AddFromBillDialog.tsx`).

### 5. 🎯 Customers, Segments & Direct Campaigns
- **Customer Segmentation**: Automatic segment tagging (`chronic`, `refill_due`, `inactive`, `high_value`, `new_customer`) with instant count badges and customer profile history (`src/pages/Segments.tsx`, `src/pages/Customers.tsx`).
- **Direct Campaign Dispatch**: Filter-to-send dialog for blasting announcements, offers, and seasonal alerts with WhatsApp rate-limit guards (`src/components/crm/CampaignSendDialog.tsx`, `src/pages/Campaigns.tsx`).
- **Real-time Query Cache Invalidation**: Automatic optimistic updates on customer status changes, reminders, and opt-outs.

### 6. 🌐 Dual Language Support (English & Hindi)
- Comprehensive internationalization system covering all pages, buttons, modals, error messages, and reminder statuses (`src/i18n/en.ts`, `src/i18n/hi.ts`).

### 7. 🛡️ Database Migrations & Security Hardening
- **Security Definer Views**: Fixed RLS bypass on derived views (`supabase/migrations/20260816181903_fix_security_definer_views.sql`).
- **Postgres Optimization**: Warning cleanups and index optimizations (`supabase/migrations/20260816182753_fix_warnings.sql`).
- **WhatsApp Rate Limit Guard**: Trigger preventing unauthorized outbound burst requests (`supabase/migrations/20260817001200_fix_can_send_now_guard.sql`).

---

## 🚀 Getting Started

### 1. Configure Environment Variables

Create `.env` based on `.env.example`:

```bash
cp .env.example .env
```

| Variable | Scope | Description |
|----------|-------|-------------|
| `VITE_SUPABASE_URL` | Client | Supabase Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | Supabase Anon Key (shared with inventory app) |
| `VITE_INVENTORY_APP_URL` | Client | URL of main Medstocksy inventory app (`https://app.medstocksy.in`) |
| `VITE_APP_URL` | Client / Server | URL of Medstocksy Connect app |
| `VITE_GEMINI_API_KEY` | Client / Server | Google Gemini API key for OCR parsing |
| `SUPABASE_SERVICE_ROLE_KEY` | Server (Vercel) | Supabase Admin Secret Key for API routes |
| `WHATSAPP_PHONE_NUMBER_ID` | Server (Vercel) | Meta Cloud API Phone Number ID |
| `WHATSAPP_ACCESS_TOKEN` | Server (Vercel) | Meta Permanent System User Access Token |
| `WHATSAPP_VERIFY_TOKEN` | Server (Vercel) | Webhook verification handshake token |
| `RESEND_API_KEY` | Server (Vercel) | Resend API key for custom transactional emails |

### 2. Apply Database Migrations

Run with the Supabase CLI or copy into your Supabase SQL Editor:

```bash
# Apply schema and incremental migration patches
supabase db push
# Or run files in supabase/migrations/ sequentially in SQL editor:
# 1. 20260507_medcrm.sql
# 2. 20260816181903_fix_security_definer_views.sql
# 3. 20260816182753_fix_warnings.sql
# 4. 20260817001200_fix_can_send_now_guard.sql
```

### 3. Install & Run Locally

```bash
npm install
npm run dev       # Starts local dev server at http://localhost:5174
```

### 4. Build & Typecheck

```bash
npm run typecheck # Strict TypeScript check
npm run build     # Production build with PWA service worker bundle
npm run preview   # Preview production bundle
```

---

## 📂 Project Structure

```
Medstocksy-Connect/
├── api/                               # Vercel Serverless Functions
│   ├── email/                         # Transactional email handlers (Resend)
│   │   ├── reset-password.ts          # Branded password reset email dispatch
│   │   ├── welcome.ts                 # Welcome onboarding email dispatch
│   │   └── template.ts                # Base HTML email renderer
│   └── whatsapp/
│       ├── send.ts                    # WhatsApp message dispatch with rate limiter
│       └── webhook.ts                 # WhatsApp inbound & status webhook handler
├── public/                            # Static PWA icons, manifest & assets
├── react-email-starter/               # React Email development & preview workspace
│   └── emails/
│       ├── medstocksy-reset-password.tsx
│       └── medstocksy-welcome.tsx
├── src/
│   ├── components/
│   │   ├── crm/                       # Domain CRM Modals & Drawers
│   │   │   ├── AddFromBillDialog.tsx
│   │   │   ├── BulkReminderSendDialog.tsx
│   │   │   ├── CampaignDialog.tsx
│   │   │   ├── CampaignSendDialog.tsx
│   │   │   ├── ComposeDrawer.tsx
│   │   │   ├── CustomerFormDialog.tsx
│   │   │   ├── PrescriptionDialog.tsx
│   │   │   ├── QuickReminderDialog.tsx
│   │   │   ├── RateMeter.tsx
│   │   │   └── RescheduleReminderDialog.tsx
│   │   ├── layout/                    # Shell, Navbar, Sidebar & Notifications
│   │   │   ├── AppSidebar.tsx
│   │   │   ├── Layout.tsx
│   │   │   ├── RemindersBell.tsx
│   │   │   └── TodayRemindersPopup.tsx
│   │   └── ui/                        # Radix + Tailwind UI Primitives
│   ├── contexts/
│   │   ├── AuthContext.tsx            # Supabase Auth session & reset state
│   │   └── PharmacyContext.tsx        # Multi-tenant pharmacy switcher & RBAC
│   ├── i18n/                          # Internationalization Dictionaries
│   │   ├── en.ts                      # English strings
│   │   └── hi.ts                      # Hindi strings
│   ├── lib/
│   │   ├── api/                       # Typed Supabase & Serverless Data Layer
│   │   │   ├── campaigns.ts
│   │   │   ├── customers.ts
│   │   │   ├── email.ts
│   │   │   ├── messages.ts
│   │   │   ├── prescriptions.ts
│   │   │   ├── reminders.ts
│   │   │   └── templates.ts
│   │   ├── ocr/                       # Prescription parsing schemas & rules
│   │   │   └── fields.ts
│   │   ├── pdf/                       # PDF rasterization & extraction
│   │   │   ├── extract.ts
│   │   │   └── usePdfExtraction.ts
│   │   ├── gemini.ts                  # Google Gemini AI Vision client
│   │   ├── supabase.ts                # Shared Supabase client instance
│   │   └── utils.ts                   # Formatting, date helpers & Indian phone validation
│   ├── pages/                         # Core Application Views
│   │   ├── Activity.tsx               # Real-time message & audit timeline
│   │   ├── AuthCallback.tsx           # OAuth / Auth redirect landing
│   │   ├── Campaigns.tsx              # Campaign management & history
│   │   ├── CustomerProfile.tsx        # Customer 360 profile, stats & bills
│   │   ├── Customers.tsx              # Customer list, filters & actions
│   │   ├── Dashboard.tsx              # KPIs, health cards & upcoming reminders
│   │   ├── Login.tsx                  # Sign-in & password recovery trigger
│   │   ├── Onboarding.tsx             # New pharmacy setup wizard
│   │   ├── PrescriptionWorkflow.tsx   # Prescription OCR scanning & conversion
│   │   ├── Reminders.tsx              # Refill reminders management & filters
│   │   ├── ResetPassword.tsx          # Password update & validation
│   │   ├── Segments.tsx               # Smart customer segments
│   │   ├── Settings.tsx               # Pharmacy settings & WhatsApp config
│   │   └── Templates.tsx              # WhatsApp message templates
│   ├── types/
│   │   └── database.ts                # Auto-generated Supabase TypeScript definitions
│   ├── App.tsx                        # Root Router & Providers
│   ├── main.tsx                       # React mounting & PWA registration
│   └── index.css                      # Global design tokens
├── supabase/
│   └── migrations/                    # SQL schema definitions & RLS migrations
├── vite.config.ts                     # Vite + PWA + Build optimization config
└── vercel.json                        # Vercel serverless runtime & security headers
```

---

## 📊 Status & Roadmap

### ✅ Shipped & Production Ready
- [x] Multi-tenant pharmacy data isolation with strict Row-Level Security (RLS).
- [x] Unified SSO with Medstocksy inventory app.
- [x] Gemini AI Prescription OCR extraction from Images & PDFs.
- [x] Dedicated `/reset-password` recovery flow with Resend custom email templates.
- [x] Progressive Web App (PWA) with offline caching and mobile support.
- [x] Interactive Refill Reminders (Bulk Send, Reschedule, Bill Linking, Bell Popup).
- [x] Customer 360 profile with purchase history, tags, and WhatsApp communication timeline.
- [x] Smart Segment Filtering & direct Campaign dispatch dialog.
- [x] WhatsApp Meta Cloud API direct integration with opt-out ("STOP") handler.
- [x] Full English and Hindi (i18n) localization.

### 🟡 Next Phase Enhancements
- [ ] Automated scheduled reminder background worker via Supabase pg_cron / Edge Functions.
- [ ] Meta webhook HMAC signature validation (`x-hub-signature-256`).
- [ ] Custom segment rule builder UI.
- [ ] Automated E2E test suite (Playwright/Vitest).

---

## 🛡 License

Proprietary — Medstocksy. All rights reserved.
