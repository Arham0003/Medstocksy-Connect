# Medstocksy Connect — Deep-Dive Security, Architecture & Performance Audit Report

**Date**: August 26, 2026  
**Auditor**: Senior Application Security Engineer & Principal Software Architect  
**Scope**: Serverless APIs (`/api/*`), Database Migrations & RPCs (`/supabase/migrations/*`), Client Services & OCR (`/src/lib/*`, `/src/components/*`)

---

## Executive Summary Matrix

| # | Pillar | Category | Finding | Target File | Severity |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Security** | Auth / Access Control | Open Redirect & Account Takeover via `redirectTo` | `api/email/reset-password.ts` | `CRITICAL` |
| **2** | **Logic Break** | Core Architecture | Background Cron 100% Broken for `service_role` | `supabase/migrations/` & `api/cron/dispatch-reminders.ts` | `CRITICAL` |
| **3** | **Security** | Authentication | Missing Webhook Signature Verification | `api/whatsapp/webhook.ts` | `CRITICAL` |
| **4** | **Security** | Authorization (IDOR) | Cross-Tenant Data Leakage in WhatsApp Dispatch | `api/whatsapp/send.ts` | `HIGH` |
| **5** | **Logic Break** | Data Integrity | Destructive Non-Atomic Prescription Update | `src/lib/api/prescriptions.ts` | `HIGH` |
| **6** | **Logic Break** | Data Normalization | Phone Format Mismatch Drops Opt-Outs & Replies | `api/whatsapp/webhook.ts` | `HIGH` |
| **7** | **Performance** | Latency / Timeout | Sequential N+1 Waterfall in Serverless Execution | `api/cron/dispatch-reminders.ts` & `webhook.ts` | `HIGH` |
| **8** | **Missing Logic** | Resource Management | Client-Side PDF.js Worker & Document Memory Leak | `src/lib/pdf/extract.ts` | `MEDIUM` |
| **9** | **Missing Logic** | Type Safety | Unhandled `TypeError` Crashes on Missing Variables | `api/whatsapp/send.ts` & `dispatch-reminders.ts` | `MEDIUM` |
| **10** | **Security** | Injection | Unsanitized HTML Email Template Interpolation | `api/email/_template.ts` | `MEDIUM` |
| **11** | **Security** | Cryptography | Secret Comparison Timing Side-Channel | `api/cron/dispatch-reminders.ts` | `LOW` |

---

## Detailed Findings & Remediations

### Finding 1: Open Redirect & Account Takeover via Unvalidated `redirectTo`

- **Category**: Security
- **Severity**: Critical
- **Issue**: `api/email/reset-password.ts` takes `redirectTo` directly from untrusted user input (`req.body.redirectTo`) and passes it to Supabase Admin's `auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: resetRedirect } })` without origin validation.
- **Impact**: An attacker can initiate a password reset targeting a victim's email with `redirectTo: "https://evil.com"`. When the victim clicks the authentic email link from Medstocksy, Supabase verifies the token and redirects the victim to `evil.com` with their secret recovery auth hash/tokens, leading to complete account takeover.
- **Remediation**:
Enforce a strict origin allowlist in `api/email/reset-password.ts`:

```typescript
// api/email/reset-password.ts
const ALLOWED_ORIGINS = new Set([
  'https://connect.medstocksy.in',
  'http://localhost:5173',
  process.env.VITE_APP_URL,
].filter(Boolean));

function resolveRedirectOrigin(requested?: string): string {
  if (!requested) return process.env.VITE_APP_URL || 'https://connect.medstocksy.in';
  try {
    const origin = new URL(requested).origin;
    return ALLOWED_ORIGINS.has(origin) ? origin : (process.env.VITE_APP_URL || 'https://connect.medstocksy.in');
  } catch {
    return process.env.VITE_APP_URL || 'https://connect.medstocksy.in';
  }
}

// Inside handler:
const targetOrigin = resolveRedirectOrigin(redirectTo);
const resetRedirect = `${targetOrigin.replace(/\/$/, '')}/reset-password`;
```

---

### Finding 2: Background Cron Reminders 100% Broken by `auth.uid() IS NULL` in `crm_can_send_now`

- **Category**: Logic Break
- **Severity**: Critical
- **Issue**: `api/cron/dispatch-reminders.ts` invokes `admin.rpc('crm_can_send_now', { p_pharmacy_id })` using the `SUPABASE_SERVICE_ROLE_KEY`. Migration `20260817001200_fix_can_send_now_guard.sql` checks `IF NOT public.crm_is_member(p_pharmacy_id) THEN RETURN false; END IF;`. Because `crm_is_member()` compares `owner_id = auth.uid() OR user_id = auth.uid()`, and `auth.uid()` is `NULL` for background service-role cron executions, `crm_can_send_now` returns `false` every time.
- **Impact**: The automated background cron skips 100% of pending reminders on every single tick. Automated WhatsApp dispatching is completely non-functional.
- **Remediation**:
Update `public.crm_can_send_now` to permit execution when invoked by `service_role`:

```sql
-- supabase/migrations/20260826_fix_can_send_now_service_role.sql
CREATE OR REPLACE FUNCTION public.crm_can_send_now(p_pharmacy_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cap   smallint;
  v_count int;
  v_window_ok boolean;
  v_is_service boolean := (auth.jwt() ->> 'role' = 'service_role' OR current_user IN ('postgres', 'service_role'));
BEGIN
  IF NOT v_is_service AND NOT public.crm_is_member(p_pharmacy_id) THEN
    RETURN false;
  END IF;

  SELECT rate_limit_per_hour,
         (now() AT TIME ZONE 'Asia/Kolkata')::time BETWEEN send_window_start AND send_window_end
    INTO v_cap, v_window_ok
    FROM public.crm_pharmacies
    WHERE id = p_pharmacy_id;

  IF NOT FOUND OR NOT v_window_ok THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.crm_send_log
    WHERE pharmacy_id = p_pharmacy_id
      AND sent_at > now() - interval '1 hour';

  RETURN v_count < v_cap;
END;
$$;
```

---

### Finding 3: Missing Signature Verification on WhatsApp Webhook

- **Category**: Security
- **Severity**: Critical
- **Issue**: `api/whatsapp/webhook.ts` handles POST events without verifying Meta's `X-Hub-Signature-256` HMAC-SHA256 signature header.
- **Impact**: Any unauthenticated client can send spoofed POST requests to `/api/whatsapp/webhook` to fake message delivery states, forge customer replies, or submit fake `STOP` commands to mass-unsubscribe real patients from receiving prescription refill reminders.
- **Remediation**:
Verify `X-Hub-Signature-256` in `api/whatsapp/webhook.ts`:

```typescript
// api/whatsapp/webhook.ts
import crypto from 'crypto';

const APP_SECRET = process.env['WHATSAPP_APP_SECRET'];

function isValidSignature(rawBody: string | Buffer, signatureHeader?: string): boolean {
  if (!APP_SECRET || !signatureHeader?.startsWith('sha256=')) return false;
  const signature = signatureHeader.slice(7);
  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') { /* ... */ }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  if (APP_SECRET && !isValidSignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  // ...
}
```

---

### Finding 4: Tenant Cross-Contamination / IDOR in WhatsApp Dispatch

- **Category**: Security
- **Severity**: High
- **Issue**: In `api/whatsapp/send.ts`, `crm_customers` is queried using only `.eq('id', body.customerId)`. It never enforces `.eq('pharmacy_id', body.pharmacyId)`.
- **Impact**: An authenticated member of Pharmacy A can send WhatsApp messages to any patient belonging to Pharmacy B by providing Pharmacy B's `customerId`, leaking recipient names and data across tenant boundaries.
- **Remediation**:
Add tenant scoping to customer and template queries in `api/whatsapp/send.ts`:

```typescript
// api/whatsapp/send.ts
const { data: customer, error: custErr } = await userClient
  .from('crm_customers')
  .select('id, name, phone, whatsapp_opted_in')
  .eq('id', body.customerId)
  .eq('pharmacy_id', body.pharmacyId) // Enforce tenant boundary
  .single();

if (custErr || !customer) return res.status(404).json({ error: 'Customer not found in this pharmacy' });

const { data: template, error: tplErr } = await userClient
  .from('crm_templates')
  .select('*')
  .eq('id', body.templateId)
  .or(`pharmacy_id.is.null,pharmacy_id.eq.${body.pharmacyId}`) // Enforce template tenancy
  .single();

if (tplErr || !template) return res.status(404).json({ error: 'Template not found' });
```

---

### Finding 5: Destructive Non-Atomic Multi-Row Prescription Update

- **Category**: Logic Break
- **Severity**: High
- **Issue**: `updatePrescription` in `src/lib/api/prescriptions.ts` modifies prescriptions by executing a `DELETE` on `crm_prescription_medicines` followed by a separate `INSERT`.
- **Impact**: If network connectivity drops or the `INSERT` operation fails (due to payload validation, DB timeout, or constraint violations), the previous medicine records have already been deleted. All prescription medicines for that patient are permanently lost.
- **Remediation**:
Wrap the update in a transactional PostgreSQL RPC:

```sql
-- supabase/migrations/20260826_atomic_prescription_update.sql
CREATE OR REPLACE FUNCTION crm_update_prescription_atomic(
  p_prescription_id uuid,
  p_rx jsonb,
  p_medicines jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pharmacy_id uuid;
BEGIN
  SELECT pharmacy_id INTO v_pharmacy_id FROM crm_prescriptions WHERE id = p_prescription_id;
  IF NOT FOUND OR NOT public.crm_is_member(v_pharmacy_id) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE crm_prescriptions
  SET doctor_name = p_rx->>'doctor_name',
      prescription_date = (p_rx->>'prescription_date')::date,
      follow_up_date = (p_rx->>'follow_up_date')::date,
      diagnosis = p_rx->>'diagnosis',
      notes = p_rx->>'notes',
      total_cost = (p_rx->>'total_cost')::numeric
  WHERE id = p_prescription_id;

  DELETE FROM crm_prescription_medicines WHERE prescription_id = p_prescription_id;

  INSERT INTO crm_prescription_medicines (
    prescription_id, position, medicine_name, form, strength, dosage, route,
    frequency, quantity, duration_days, refill_interval_days, instructions,
    substitution_allowed, medicine_notes, price, reminder_override
  )
  SELECT
    p_prescription_id,
    (m->>'position')::int,
    m->>'medicine_name',
    m->>'form',
    m->>'strength',
    m->>'dosage',
    m->>'route',
    COALESCE(m->>'frequency', 'Once daily'),
    (m->>'quantity')::int,
    (m->>'duration_days')::int,
    (m->>'refill_interval_days')::int,
    m->>'instructions',
    COALESCE((m->>'substitution_allowed')::boolean, true),
    m->>'medicine_notes',
    (m->>'price')::numeric,
    COALESCE((m->>'reminder_override')::boolean, false)
  FROM jsonb_array_elements(p_medicines) WITH ORDINALITY arr(m, idx);
END;
$$;
```

---

### Finding 6: Phone Normalization Mismatch Silently Dropping Opt-Outs & Replies

- **Category**: Logic Break
- **Severity**: High
- **Issue**: `api/whatsapp/webhook.ts` formats incoming numbers with `+` (`'+' + msg.from`), querying `.eq('phone', '+919876543210')`. However, the rest of the application (e.g. `extract.ts` and standard forms) normalizes phone numbers to 10 digits (`9876543210`) without `+91`.
- **Impact**: The database query `.eq('phone', phone)` returns 0 rows. Patient replies are dropped, and `STOP` opt-out requests are silently ignored.
- **Remediation**:
Normalize numbers to match both formats in `api/whatsapp/webhook.ts`:

```typescript
// api/whatsapp/webhook.ts
const rawDigits = msg.from.replace(/\D/g, '');
const tenDigitPhone = rawDigits.slice(-10);
const e164Phone = `+${rawDigits}`;

// Match either format in the query:
const { data: customers } = await supabase
  .from('crm_customers')
  .select('id, pharmacy_id, phone')
  .or(`phone.eq.${tenDigitPhone},phone.eq.${e164Phone},phone.eq.${rawDigits}`);
```

---

### Finding 7: Sequential N+1 Waterfall in Serverless Execution (Timeout Risk)

- **Category**: Performance
- **Severity**: High
- **Issue**: Both `dispatch-reminders.ts` and `webhook.ts` execute asynchronous database queries and external HTTP requests sequentially inside nested `for` loops (HTTP call + 3 separate DB inserts per item).
- **Impact**: A batch of 50 reminders takes 30–45+ seconds of sequential network I/O, exceeding Vercel serverless execution limits (10s on Hobby, 60s on Pro), causing duplicate sends and dropped webhook events.
- **Remediation**:
Use bounded concurrent execution (`Promise.all` with chunking):

```typescript
// api/cron/dispatch-reminders.ts
async function processConcurrently<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

// Process up to 5 sends concurrently:
await processConcurrently(due, 5, async (rem) => {
  // dispatch reminder
});
```

---

### Finding 8: Client-Side PDF.js Worker and Document Object Memory Leak

- **Category**: Missing Logic
- **Severity**: Medium
- **Issue**: `extractTextFromPdf` in `src/lib/pdf/extract.ts` calls `pdfjs.getDocument({ data: buffer }).promise`, but never calls `doc.destroy()`.
- **Impact**: PDF.js allocates Web Workers, typed arrays, and Canvas contexts. Uploading multiple prescription bills consecutively leaks browser memory, leading to tab crashes on mobile/tablet devices.
- **Remediation**:
Wrap extraction in `try...finally` in `src/lib/pdf/extract.ts`:

```typescript
// src/lib/pdf/extract.ts
export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).href;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  try {
    const pageLines: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        // ... process lines
      } finally {
        page.cleanup();
      }
    }
    return pageLines.join('\n');
  } finally {
    await doc.destroy();
  }
}
```

---

### Finding 9: Unhandled `TypeError` Crashes on Missing Payload Variables

- **Category**: Missing Logic
- **Severity**: Medium
- **Issue**: `api/whatsapp/send.ts` accesses `body.variables[key]` without verifying that `body.variables` is defined, and casts `(template.variables as string[]).map(...)` assuming `template.variables` is always an array. In `dispatch-reminders.ts`, `rem.template!.body` is asserted without null checks.
- **Impact**: Malformed requests or templates with null variables cause unhandled `TypeError` crashes (500 Internal Server Error) and abort cron executions.
- **Remediation**:
Add defensive guards in `api/whatsapp/send.ts`:

```typescript
// api/whatsapp/send.ts
const vars: Record<string, string> = (body.variables && typeof body.variables === 'object') ? body.variables : {};
const renderedBody = String(template.body ?? '').replace(/\{(\w+)\}/g, (_match, key) => {
  return vars[key] ?? `{${key}}`;
});

const templateVarList = Array.isArray(template.variables) ? (template.variables as string[]) : [];
// Inside template components:
parameters: templateVarList.map((v: string) => ({
  type: 'text',
  text: vars[v] ?? '',
})),
```

---

### Finding 10: HTML Injection / Unescaped Interpolation in Email Templates

- **Category**: Security
- **Severity**: Medium
- **Issue**: In `api/email/_template.ts`, `fullName` and `pharmacyName` are directly interpolated into raw HTML strings without sanitization or HTML entity escaping.
- **Impact**: Crafted user or pharmacy names can inject malicious HTML or CSS into outbound emails, resulting in layout defacement or CSS/link exfiltration.
- **Remediation**:
Add an HTML escaping utility in `api/email/_template.ts`:

```typescript
// api/email/_template.ts
function escapeHtml(str?: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getWelcomeEmailHtml(args: { fullName?: string; pharmacyName?: string; loginUrl?: string }): string {
  const firstName = escapeHtml(args.fullName?.trim().split(' ')[0] || 'there');
  const pharmacyName = escapeHtml(args.pharmacyName);
  // Interpolate escaped variables...
}
```

---

### Finding 11: Timing Attack on `CRON_SECRET` Header Comparison

- **Category**: Security
- **Severity**: Low
- **Issue**: `api/cron/dispatch-reminders.ts` uses standard JavaScript inequality (`req.headers.authorization !== 'Bearer ' + CRON_SECRET`).
- **Impact**: Early-terminating string comparisons introduce a timing side-channel that may allow remote attackers to guess the secret byte-by-byte.
- **Remediation**:
Use `crypto.timingSafeEqual` in `api/cron/dispatch-reminders.ts`:

```typescript
// api/cron/dispatch-reminders.ts
import crypto from 'crypto';

function safeCompare(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// In handler:
if (!safeCompare(req.headers.authorization, `Bearer ${CRON_SECRET}`)) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```
