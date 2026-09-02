# Medstocksy Connect (medcrm-v2) — Feature Reference

A complete inventory of every section, element, button, and field currently in the app, grouped by where the user encounters them. Use this as the single source of truth for "what does X do" when reviewing the build or onboarding a teammate.

---

## 0. Cross-cutting capabilities

These apply across every page.

### 0.1 Authentication
- **Google OAuth** sign-in / sign-up — PKCE flow via Supabase Auth.
- **Email + password** — sign-in and sign-up in tabs on the Login page.
- **Session persistence** — `localStorage` keeps the user signed in across reloads; tokens auto-refresh.
- **Sign-up email confirmation** flag is surfaced when Supabase requires it; user is told to check inbox.
- **Sign-out** — clears session, redirects to `/login`. Triggered from sidebar footer **or** Settings → Account.

### 0.2 Multi-tenancy (Pharmacy switcher)
- `crm_pharmacies` is the multi-tenant root; **one pharmacy per owner** enforced by `UNIQUE(owner_id)`.
- `crm_members` adds `staff`/`manager`/`admin` roles.
- A user with access to multiple pharmacies sees a **`<select>` switcher** in the sidebar header; single-pharmacy users see plain text.
- `activePharmacyId` is persisted to `localStorage` and reconciled with live memberships on auth refresh.
- All CRUD operations scoped via Row-Level Security (`crm_is_member(pharmacy_id)`).

### 0.3 Language
- Top-of-screen toggle (Light/Dark) lives in **Settings → Preferences**.
- Two languages: **English (`en`)** and **Hindi (`hi`)**.
- Stored per-device in `localStorage` as `medcrm.language`.
- On first visit, `navigator.language` is used to auto-detect.
- Sets `<html lang="…">` so screen readers behave correctly.
- Devanagari font fallback (`Noto Sans Devanagari`) auto-applied to Hindi text.

### 0.4 Theme (Light / Dark / System)
- **Three-state segmented control** in Settings → Preferences.
- Persisted as `medcrm.theme` in `localStorage`.
- Applies `.dark` class to `<html>` and sets `style.colorScheme`.
- `system` mode listens to `prefers-color-scheme` and follows OS changes live.
- A pre-hydration `<script>` in `index.html` applies the theme **before React mounts** to prevent the light-flash.

### 0.5 WhatsApp safety (PRD §2.3 + Rule 9)
- **Hourly rate limit** per pharmacy (default 10, hard cap 20).
- **Send window** — local IST hours; `crm_can_send_now()` checks both rate and window.
- **Opt-out tracking** — `whatsapp_opted_in` bool + opt-out timestamp + reason on `crm_customers`.
- **Bounce rate** computed live in `crm_whatsapp_health` view (warns above 5 %).
- **Audit log** — every customer/message/campaign mutation captured in `crm_audit_log` with 90-day retention via `crm_purge_old_audit()`.

### 0.6 Auto-tags (derived, no manual entry)
- View `crm_customer_auto_tags` derives:
  - **New** — created within last 7 days
  - **Repeat** — ≥ 2 events
  - **High value** — lifetime spend ≥ ₹10 000
  - **Inactive** — no event in 30+ days

### 0.7 Manual tag
- **Chronic** — toggled on the customer profile; lives in `crm_tags(tag_key='chronic')`.

### 0.8 Brand identity (locked)
- Medstocksy logo bundled at build time from `src/assets/brand/medstocksy.png`.
- Imported as an ES module → fingerprinted by Vite → cannot be changed at runtime.
- Used in the sidebar logo tile fallback and the Settings → About banner.

---

## 1. Layout — Sidebar (`AppSidebar.tsx`)

### 1.1 Brand + active pharmacy header (one combined block)
- **Logo tile** (40 × 40, rounded-xl, primary gradient + ring):
  - Shows the **uploaded pharmacy logo** if `crm_pharmacies.logo_url` is set.
  - Otherwise falls back to the **Medstocksy PNG** (`src/assets/brand/medstocksy.png`).
- **Pharmacy name** in bold (15 px, foreground gradient).
- **Role badge** below name — colored pill: `admin` (primary + ShieldCheck icon), `manager` (amber), `staff` (neutral).
- **Pharmacy switcher** — when the user belongs to >1 pharmacy, the name becomes a transparent `<select>` with a `ChevronDown` indicator.
- **Collapse chevron** (top-right) — toggles sidebar between 256 px expanded and 64 px collapsed; state persisted as `medcrm.sidebar.collapsed`.

### 1.2 Primary nav (vertical list of NavLinks)
- 🏠 **Dashboard** → `/`
- 👥 **Customers** → `/customers`
- 🧩 **Segments** → `/segments`
- 📣 **Campaigns** → `/campaigns`
- 🔔 **Reminders** → `/reminders`
- 📄 **Templates** → `/templates`
- 📊 **Activity** → `/activity`
- Active route gets a 1-px primary highlight bar on the left edge.
- When sidebar is collapsed, only icons show; full label appears as a native tooltip.

### 1.3 Secondary nav (below divider)
- 🔁 **Inventory app** — opens `VITE_INVENTORY_APP_URL` in same tab.
- ⚙️ **Settings** → `/settings`.

### 1.4 User footer
- **Avatar** (initials of user's full name or email prefix).
- **Name + email** (truncated).
- **Sign-out** icon button.

### 1.5 Mobile behaviour
- Sidebar becomes a full-width drawer; `translate-x` toggled by a hamburger in `Layout.tsx`.
- Tap a nav link → drawer auto-closes via `onMobileClose`.

---

## 2. Login (`pages/Login.tsx`)

### 2.1 Mode tabs
- **Sign in** | **Create account** — toggles the form's submit action.

### 2.2 Form fields
- **Email** — required, type=email.
- **Password** — required, min 6 chars.
- **Submit button** — label switches between "Sign in" / "Create account" with a Loader2 spinner during pending.

### 2.3 OAuth
- **Continue with Google** button — Supabase PKCE flow with `redirectTo=/auth/callback`.

### 2.4 Confirmation states
- Email signup that requires confirmation shows a "Check your inbox" panel.
- Existing-account error surfaces "Invalid login credentials" → suggests switching to sign-up.

### 2.5 Cross-links
- Forgot password (placeholder; not wired to a real reset flow yet).

---

## 3. Onboarding (`pages/Onboarding.tsx`)

Shown when a user has no pharmacies yet.

- **Step 1: Pharmacy name** (required).
- **Step 2: Contact phone + WhatsApp number** — both validated as +91-prefixed E.164.
- **Step 3: Address** (optional).
- **Submit** — atomically creates `crm_pharmacies` + adds the creator to `crm_members` as admin via the trigger, then seeds the pharmacy cache and navigates to `/`.

---

## 4. Dashboard (`pages/Dashboard.tsx`)

### 4.1 Greeting header
- Local-date label ("Saturday, 10 May").
- "Good morning/afternoon/evening, {name}".
- Subtitle: `{count} customers · {reminders} upcoming reminders`.
- **+ New message** button → opens `CustomerPickerDialog` then `ComposeDrawer`.
- **+ New campaign** button → navigates to `/campaigns`.

### 4.2 Four KPI tiles (compact, icon-led; 2-up on phones, 4-up on lg)
Each is a clickable card with:
- Colored 40 × 40 icon chip (semi-transparent dot color).
- Tiny uppercase label (10 px tracked caps).
- 2xl bold value (`tabular-nums`).
- Truncated subtitle.

The four tiles:
1. **Customers** — Users icon, green — total count, "+N this week" → `/customers`.
2. **Today's reminders** — BellRing icon, orange — total scheduled today, "X sent · Y pending" → `/reminders`.
3. **Visits this month** — Activity icon, purple — count from `crm_customer_sales` for current month → `/activity`.
4. **Chronic patients** — HeartPulse icon, coral — count of `crm_tags.tag_key='chronic'`, "X% of total" → `/customers?segment=chronic`.

### 4.3 Upcoming reminders panel
- Lists next 8 pending `crm_scheduled_reminders`.
- Each row: avatar bell icon + customer name + phone (mono) + date/time + template name.
- Click row → navigates to customer profile.
- **View all →** button (top-right) → `/reminders`.

### 4.4 WhatsApp health card
- **RateMeter** component: progress bar showing `sends_last_hour / rate_limit_per_hour`.
- **Bounce rate (24h)** — green if ≤5 %, destructive red if >5 %.
- **Opt-out rate (30d)** — `opt_outs_30d / total_customers` as %.
- **Send window line** — "Window 09:00 – 20:00 IST".
- Auto-refreshes every 60 seconds.

---

## 5. Customers (`pages/Customers.tsx`)

### 5.1 Header
- Title "Customers" + subtitle "Showing X of Y".
- **Export** button — downloads CSV of currently visible rows (Name, Phone, Last Visit, LTV, Visits).
- **+ Add customer** button — opens `CustomerFormDialog` in create mode.

### 5.2 Segment chips (7 chips)
All / New / Repeat / Inactive / High value / Chronic / Opt-out. Active chip uses inverted colors (foreground bg + background text).

### 5.3 Search + sort row
- **Search input** — searches `name OR phone` via `ILIKE %query%`; left-anchored Search icon.
- **Sort dropdown** — right-anchored, with ArrowUpDown icon on the right. No "SORT" caption label. Options:
  - Newest first (default — new customers appear at top)
  - Oldest first
  - Name (A–Z)
  - Recent visit (uses `crm_customer_stats.last_visit_at`)
  - Top spend (uses `crm_customer_stats.lifetime_value`)
- Server sorts `newest/oldest/name`; client sorts `recent_visit/top_spend` after fetch.

### 5.4 Customer table
Columns:
- **Customer** — avatar (initials) + name + age/gender subline. **Family members get an amber avatar tint + "Family of {primary}" badge.**
- **Phone** — mono.
- **Last visit** — relative ("2 days ago"); pulls from unified stats view.
- **LTV** — formatted INR; sums `crm_customer_sales.bill_amount + crm_prescription_refills.bill_amount`.
- **Visits** — `visit_count` from unified stats (sales + visit notes + prescriptions + refills).
- **Tags** — auto tags + opt-out chip when applicable.
Row click → `/customers/:id`.

### 5.5 Empty state
"No customers match" with prompt to clear filters or add the first customer.

---

## 6. Customer profile (`pages/CustomerProfile.tsx`)

### 6.1 Breadcrumb
- "← Back to customers" link.

### 6.2 Hero
- **Avatar** (64 × 64, gold tint).
- **Name** (3xl bold).
- **Status pill** (clickable button — see §6.8) — Active (green) or Opted out (red), with a small status dot.
- Phone (mono), age · gender, "Customer since DATE".
- Auto-tags row (New / Repeat / High value / Inactive).
- **Action buttons** (right side, wrap):
  - **Edit** — outline button, opens `CustomerFormDialog` in edit mode.
  - **Add visit note** — outline button (NotebookPen icon), opens `VisitNoteDialog`.
  - **Add prescription** — outline button (FileText icon), opens `PrescriptionDialog`.
  - **Send message** — primary button (Send icon), opens `ComposeDrawer`; **disabled when `whatsapp_opted_in === false`**.

### 6.3 Stat strip (4 cards in a single rounded container)
1. **Last visit** — relative time; subtitle "No visit recorded yet" if null.
2. **Lifetime spend** — formatted INR; subtitle `N visits`.
3. **Frequency** — "Every N days"; subtitle "Needs at least 2 visits to compute" when null.
4. **Status** — "Reachable" / "Opted out".

### 6.4 Prescriptions section
- Heading with FileText icon + count badge.
- **+ Add prescription** button (ghost, top-right).
- Each prescription card:
  - Date (day/month/year), doctor name (with Stethoscope icon).
  - Diagnosis (bold).
  - **Follow-up chip** (amber) if `follow_up_date` set.
  - Medicine list — each medicine is a `MedicineLine` (see §6.5).
  - Notes line (muted, pre-wrap).
  - **Edit / Renew / Delete** icon buttons.
- Empty state: dashed-border tile prompting first prescription.

### 6.5 `MedicineLine` (per-medicine row inside a prescription)
- Top row: `Pill` icon + name + dosage + frequency + ×quantity.
- **Refill summary chips** (bottom row):
  - **Emerald**: "Refilled N×" (when count > 0) or "Not refilled yet".
  - "Last DATE" — last refill date.
  - **Next-due chip** with three states:
    - **Red** — "overdue by N days".
    - **Amber** — "next in 0–3 days".
    - **Grey** — "next in N days".
- **🔄 Refill** outline button (right side) — opens `RefillDialog`.

### 6.6 Activity timeline
Reverse-chronological merge of four event types:
- **Bill** (`crm_customer_sales`) — primary dot, bill amount + sale ID.
- **Message** (`crm_messages`) — sky dot, "Message sent/received" + body excerpt.
- **Visit note** (`crm_visit_notes`) — amber dot, note text + pill chips for medicines.
- **Prescription** (`crm_prescriptions`) — violet dot, "Prescription · Dr. X", diagnosis line, medicine pills with dosage.

### 6.7 Chronic toggle card
- Bottom of profile.
- Pressable card with Stethoscope icon chip + label + descriptive subtitle.
- Toggle pill turns purple when active.
- Inserts/deletes a `crm_tags` row with `tag_key='chronic'`.

### 6.8 Status pill (opt-in / opt-out toggle)
- Clickable, with hover-fade.
- **Active → opt-out flow**:
  1. `prompt()` for opt-out reason (compliance per Rule 9).
  2. If blank, secondary confirm "Opt out without a reason on file?"
  3. Calls `setOptOut(customerId, reason)` → sets `whatsapp_opted_in=false`, stamps `whatsapp_opted_out_at`, stores reason.
- **Opted out → re-activate flow**:
  1. `confirm()` "Re-activate WhatsApp messages?"
  2. Calls `setOptIn(customerId)` → clears opt-out fields.
- Loading state shows "…", disabled while pending.

---

## 7. `CustomerFormDialog` — Add / Edit customer

### 7.1 Fields (row-by-row)
- Row 1: **Name** (required) | **Phone** (required, E.164 +91 prefix, validation on blur).
- Row 2: **Age** | **Gender** (select: male/female/other) | **Address**.

### 7.2 Footer
- **Cancel** ghost button.
- **Create customer / Update customer / Saving…** primary button.

### 7.3 Phone-collision flow (new customer with existing phone)
- On Postgres `23505` error, dialog catches it and pivots to the **collision panel**:
  - Avatar + name + phone of existing primary customer.
  - Explanation about family members sharing one phone.
  - **Open existing profile** outline button (navigates to that customer).
  - **Add as family of {name}** primary button — re-inserts with `family_of_id` set, bypassing the partial unique index.
- Save button hides when the panel is visible; editing the phone clears the panel.

---

## 8. `VisitNoteDialog`

### 8.1 Fields
- **Note** (textarea, required, max 1024 chars, char counter).
- **Medicines** (optional chip-style input):
  - Type → Enter or comma → adds as chip.
  - Backspace on empty input removes the last chip.
  - Click ✕ on a chip → removes.
  - Cap of 20 medicines.

### 8.2 Save
- Inserts into `crm_visit_notes`.
- Invalidates `visit-notes`, `customer-activity`, `customer`, `customers` queries → stat strip refreshes live.

---

## 9. `PrescriptionDialog` (max-w-3xl, sticky header/footer)

### 9.1 Gradient header strip
- FileText icon chip + title + subtitle ("Record a new prescription for {name}").

### 9.2 Patient summary card
- Avatar + name + phone + age + gender — read-only confirmation.

### 9.3 Section 1 — Consultation
- **Doctor** (optional, max 120 chars).
- **Date** (required, defaults to today, max=today).
- **Follow-up** (optional, must be ≥ prescription date — inline error shown otherwise).
- **Diagnosis** (optional, max 240 chars).

### 9.4 Section 2 — Medicines (required)
Each medicine is a card with:
- "Medicine N" badge (ClipboardList icon) + ✕ remove (disabled when only 1).
- Row 1: **Name** (required) | **Dosage**.
- Row 2: **Frequency** select (Once daily / Twice daily / Three times daily / As needed / Weekly / Monthly) | **Quantity** (pcs) | **Duration** (days) | **Refill** (days).
- Row 3: **Instructions** select (None / Before meals / After meals / With food / On empty stomach / At bedtime / As directed).
- **+ Add another medicine** outline button.
- Amber callout: "Reminders auto-scheduled for medicines with a refill interval."

### 9.5 Section 3 — Notes (optional)
- Textarea, 1024-char cap, live counter.

### 9.6 Sticky footer
- **Cancel** | **Create prescription / Save changes / Saving…**

### 9.7 Auto-reminder side-effect on save
For each medicine with `refill_interval_days > 0`:
- Picks the first `refill_reminder` template available to the pharmacy.
- Schedules a `crm_scheduled_reminders` row at `today + interval − 5 + index` at 09:00 IST (index staggers multi-medicine prescriptions).
- Best-effort: prescription still saves if scheduling fails.

---

## 10. `RefillDialog`

### 10.1 Medicine summary card (read-only)
- Pill icon + name + dosage + frequency.
- "N prior refills · next in M days" subline (when present).

### 10.2 Fields
- **Quantity** (number, 1–999, pcs unit) — pre-fills from prescription's stored quantity.
- **Bill amount** (₹, optional, decimal) — flows into `lifetime_value`.
- **Notes** (optional, max 500 chars).

### 10.3 Save side-effects
- Writes `crm_prescription_refills` row.
- Schedules **next** refill reminder for the same medicine (offset of refill_interval_days − 5).
- Invalidates `prescriptions / customer-activity / customer / customers` queries → hero stat strip + medicine refill chips update live.

---

## 11. Segments (`pages/Segments.tsx`)

- Pre-built segment tiles (PRD §2.5): New / Repeat / Inactive / High value / Chronic.
- Each tile shows live count + sample 3 customers.
- Click a tile → navigates to `/customers?segment={key}` with filter applied.
- Per Rule 8, no custom-filter builder in V1.

---

## 12. Campaigns (`pages/Campaigns.tsx`)

### 12.1 Header
- "Campaigns" title + count subtitle.
- **+ New campaign** button → opens `CampaignDialog`.

### 12.2 Table (status, name, segment, recipients, sent, delivered, failed, replies)
- Status pill: draft (grey) / scheduled (amber) / sending (sky pulsing) / sent (emerald) / cancelled (muted) / failed (destructive).
- Click row → expands into a sub-view (recipients list, per-customer delivery status).

### 12.3 `CampaignDialog`
- Fields: **Name** (required), **Segment** (select with live count), **Template** (select; filtered to approved), **Schedule** (datetime or "send now").
- **Bulk approval threshold warning** — if recipient count > `pharmacy.bulk_approval_threshold`, shows yellow callout requiring admin approval.
- **Save draft** ghost button | **Schedule send** primary button.

---

## 13. Reminders (`pages/Reminders.tsx`)

### 13.1 Header tabs
- Rules | Scheduled (upcoming).

### 13.2 Rules tab
- List of `crm_reminder_rules` rows: medicine label, cycle, offset, template, send time, active toggle.
- **+ New rule** → opens `ReminderRuleDialog`.

### 13.3 `ReminderRuleDialog` (redesigned)
- Gradient header strip with Bell icon.
- **Section 1 — Trigger** (Pill icon): Medicine label (required, with hint), Refill cycle (days unit).
- **Section 2 — Schedule** (CalendarClock icon): Offset (days-before unit), Send time (IST). Inline validation ensures offset < cycle. **Live timeline preview** — 3-stop progress bar (sale → reminder → refill due) with emerald/amber/rose stops.
- **Section 3 — Message** (MessageSquare icon): Template select with ★ for built-ins and language tag. Selected template body previews in emerald card.
- **Status toggle** (Power icon card with switch).
- Sticky footer Cancel / Save.

### 13.4 Scheduled tab
- Calendar grid showing pending reminders per day.
- Each cell: customer name + medicine + template; click → opens preview.

---

## 14. Templates (`pages/Templates.tsx`)

### 14.1 Grid
- Cards for each `crm_templates` row.
- Header: T1/T2/T3 code, "PRE-BUILT" or "CUSTOM" tag, EN/हिन्दी language pill, optional ImageIcon if `image_url` set.
- Body preview in emerald-tinted card (line-clamp-5), Devanagari font for `hi`.
- Variables row — mono-style chips for each `{var}`.

### 14.2 `TemplateDialog` (scrollable, max-w-2xl)
- Row 1: Name (required) | Kind select | Language toggle (EN | हिन्दी).
- **Body** textarea (h-36, non-resizable, max 1024 chars, language attribute set, Devanagari font on Hindi).
- **Translate button** (primary; flips between "Translate → हिन्दी" / "Translate → EN") — uses MyMemory free API, masks `{variables}` by splitting on them so they never reach the translator.
- **Variable chips** (8 quick-insert buttons): `{name}`, `{pharmacy_name}`, `{medicine}`, `{amount}`, `{pharmacy_phone}`, `{discount}`, `{category}`, `{date}` — clicking inserts at the textarea cursor.
- **Image upload** (`crm-template-images` bucket, 5 MB cap, JPG/PNG/WEBP). Shows uploaded image with Remove button.
- Built-in templates are read-only — fields disabled and a yellow lock notice shown.
- Sticky footer: Cancel | Save | Delete (when editing a custom).

---

## 15. Activity (`pages/Activity.tsx`)

- Reverse-chrono feed of all `crm_messages` for the active pharmacy.
- Each row: status pill (queued/sending/sent/delivered/read/failed/bounced) + recipient + template name + body excerpt + sent time.
- Filter chips for status.
- "Resend" button on failed rows (calls send-message API again with same payload).

---

## 16. Settings (`pages/Settings.tsx`)

Top-level layout: **left sidenav (mobile horizontal scroll)** + **animated content panel**.

### 16.1 General
- **Pharmacy logo** card (top of section):
  - 64 × 64 preview (custom logo OR Medstocksy fallback).
  - "Using the default logo" / "Custom logo uploaded" subtitle.
  - **Upload logo / Replace logo** + **Remove** buttons.
  - Uploads to `crm-pharmacy-logos` bucket (2 MB cap; PNG/JPG/WEBP/SVG).
- Form fields: **Pharmacy name** (required), **Contact phone** (+91 E.164), **WhatsApp number** (+91 E.164), **Address** (optional).
- **Reset** / **Save changes** footer.
- Admin-only writes; non-admins see read-only state + "Admin only" badge.

### 16.2 Preferences (compact 2-tile layout)
Two side-by-side bordered cards:
- **Appearance tile** (Palette icon) — Light / Dark / System segmented control. Active state = primary fill, white text, ring, shadow. Hint shows current resolved theme when system mode.
- **Language tile** (Globe icon) — English / हिन्दी segmented control. Native label + lowercase code badge.

### 16.3 WhatsApp
- **Rate limit per hour** — range slider 1–20 with safe-zone marker at 10.
- **Bulk approval threshold** — number input.
- **Send window start / end** — time pickers.
- Yellow callout warning about WhatsApp suspension risk.

### 16.4 Account
- Avatar + full name + email + role.
- "X pharmacies" indicator when user belongs to multiple.
- **Sign out** outline button.

### 16.5 About (minimal)
- **Brand banner**: Medstocksy logo tile + "Medstocksy Connect" title + `v1.0.0` chip + one-line tagline.
- **Email support** button (mailto:).

### 16.6 Danger zone (admin only)
- Deletes the entire pharmacy and all child rows (RLS cascade).
- Two-step confirm: requires typing the pharmacy name exactly.
- Navigates back to `/onboarding` after success.

---

## 17. Components — shared

### 17.1 `ComposeDrawer`
- Slides in from the right.
- Customer header (avatar, name, phone, opt-out warning if applicable).
- Template select (filtered by approved + matching language).
- Variable inputs auto-extracted from template body.
- Live message preview pane (WhatsApp-style green bubble; Devanagari font on Hindi).
- **Send now** button — calls `/api/whatsapp/send-message`. Respects rate limit (`crm_can_send_now()` checked server-side).

### 17.2 `CustomerPickerDialog`
- Live search box (debounced).
- List of matching customers with avatar + name + phone.
- Opt-out customers disabled with a small tag.
- Click → fires `onPick` callback.

### 17.3 `RateMeter`
- Horizontal progress bar.
- Three zones: safe (≤60 %), caution (60–90 %), critical (>90 %).
- Shows "X / Y this hour" with window time underneath.

### 17.4 `Tag`
- Six-color palette (capped per theme rule):
  - `new` (primary), `repeat` (success), `high_value` (gold), `inactive` (muted), `chronic` (violet), `optout` (destructive).

### 17.5 `Skeleton` / `Card` / `Button` / `Input` / `Dialog`
- shadcn/ui primitives with consistent shadow tokens (`shadow-card`, `shadow-popover`, `shadow-modal`).

---

## 18. Database schema (high-level)

### 18.1 Tables (`public.crm_*`)
| Table | Purpose |
|---|---|
| crm_pharmacies | Tenant root, one per owner. Holds rate limit, send window, **logo_url**. |
| crm_members | Role mapping per user × pharmacy. |
| crm_customers | Name + phone (E.164), age/gender/address, opt-in state, **family_of_id** (self-FK for family members). |
| crm_customer_sales | Bridge to inventory app's `public.sales` (cross-domain, no FK). |
| crm_tags | Manual tags (only `chronic` in V1). |
| crm_templates | WhatsApp templates with **language** + **image_url**; built-ins have `pharmacy_id IS NULL`. |
| crm_reminder_rules | Medicine → cycle → template rules. |
| crm_scheduled_reminders | Per-customer instances of the rules; status pending/sent/cancelled/converted/failed. |
| crm_campaigns | Bulk-send headers with status + approval gates. |
| crm_campaign_recipients | Per-customer state in a campaign. |
| crm_messages | Every outbound + inbound WhatsApp event with status timestamps. |
| crm_send_log | Sliding-hour rate limiter; one row per send. |
| crm_audit_log | 90-day mutation history. |
| crm_visit_notes | Free-text visit log with optional medicines array. |
| crm_prescriptions | Doctor/diagnosis/date/follow-up/notes. |
| crm_prescription_medicines | Per-medicine line (name, dosage, frequency, quantity, duration, refill interval, instructions). |
| crm_prescription_refills | Each repeat purchase: qty, bill amount, notes, served_by. |

### 18.2 Views
- `crm_my_pharmacies` — `pharmacy_id + role + pharmacy_name + pharmacy_logo_url` for the current user.
- `crm_customer_stats` — `visit_count + lifetime_value + last_visit_at + avg_days_between_visits`, aggregated over **sales + visit notes + prescriptions + refills**.
- `crm_customer_auto_tags` — derived tags.
- `crm_whatsapp_health` — live KPIs for the dashboard health card.

### 18.3 Storage buckets
- **`crm-template-images`** — 5 MB cap; JPG/PNG/WEBP.
- **`crm-pharmacy-logos`** — 2 MB cap; JPG/PNG/WEBP/SVG.

### 18.4 Functions
- `crm_is_member(p_pharmacy_id)` — RLS gate.
- `crm_my_role(p_pharmacy_id)` — used for admin-only writes.
- `crm_can_send_now(p_pharmacy_id)` — rate + window check.
- `crm_audit_trigger()` — generic audit logger.
- `crm_set_updated_at()` — generic updated_at maintenance.
- `crm_purge_old_audit()` — 90-day retention sweep.

### 18.5 Constraints worth knowing
- `crm_pharmacies.owner_id` UNIQUE (one pharmacy per account).
- `crm_customers` partial unique `WHERE family_of_id IS NULL` — only one **primary** customer per phone per pharmacy; family members may share.
- `crm_customers.phone` E.164 check (`^\+[1-9][0-9]{6,14}$`).
- `crm_pharmacies.rate_limit_per_hour` BETWEEN 1 AND 20.

---

## 19. Migrations (run order)

| File | What it adds |
|---|---|
| 20260507000000_medcrm_initial.sql | Core schema, RLS, audit, views, seeds. |
| 20260507100000_drop_legacy_user_triggers.sql | Strips legacy auth.users triggers. |
| 20260507110000_dedupe_pharmacies_and_view.sql | UNIQUE owner_id, view rebuild. |
| 20260507120000_template_image_language.sql | Language + image_url + template-images bucket. |
| 20260510000000_pharmacy_logo.sql | logo_url + pharmacy-logos bucket. |
| 20260510010000_visit_notes.sql | crm_visit_notes table. |
| 20260510020000_prescriptions.sql | crm_prescriptions + medicines tables. |
| 20260510030000_prescription_extras.sql | follow_up_date + quantity + instructions. |
| 20260510040000_unified_stats_view.sql | View counts notes + Rx + sales. |
| 20260510050000_customer_family.sql | family_of_id + partial unique. |
| 20260510060000_prescription_refills.sql | crm_prescription_refills + view includes refills. |

For a fresh project, **`APPLY_ALL.sql`** in the repo root combines everything idempotently.

---

## 20. Conventions & rules in force

- **PRD core thesis** (`medstocksy_connect_prd.md`) — repeat purchases + WhatsApp + simple automation.
- **Agent rules** (`medstocksy_connect_rules.md`) — Rule 10 (data simplicity), Rule 9 (WhatsApp compliance), Rule 13 (core loop protection), Rule 5 (10-min training rule).
- **i18n** — every user-facing string lives in `src/i18n/translations.ts` keyed by `<area>.<thing>`; both `en` and `hi` required for each new key.
- **Theme tokens** — all colors via HSL CSS variables in `src/index.css`; tag palette capped at 6 entries.
- **No emojis in source** unless the user explicitly requests them.
