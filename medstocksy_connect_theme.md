# Medstocksy Connect – Design Theme

**Aligned with:** PRD v1.0 + Agent Rules v1.0
**Foundation:** shadcn/ui + Tailwind CSS
**Personality:** Calm, trustworthy, low-friction. Clinical without feeling cold.
**Hard rule:** If a token, color, or component invites complexity, it does not belong in the theme.

---

## 1. Brand Essence

| Attribute | Expression |
|-----------|------------|
| **Voice** | Plain, conversational, pharmacy-appropriate ("Refill reminder", "Bill copy", "Customer") |
| **Mood** | Calm, dependable, clean — like a well-lit pharmacy counter |
| **Density** | Whitespace > density. Cards breathe. Never cram. |
| **Hierarchy** | One dominant CTA per screen. Secondary actions step back. |
| **Speed** | Visually fast: light surfaces, minimal shadow, no decorative motion |

**One-line positioning anchor:** *"One bill, one message, repeat customer."* The visual language must feel that simple.

---

## 2. Color System

### 2.1 Brand Palette (Pharmacy Blue + Green)

**Primary — Trust Blue** (clinical, dependable; used for primary CTAs, links, focus rings)

| Token | Hex | Use |
|-------|-----|-----|
| `--primary-50`  | `#EFF6FF` | Hover wash, info banners |
| `--primary-100` | `#DBEAFE` | Selected states, soft chips |
| `--primary-500` | `#2563EB` | Default primary buttons, active links |
| `--primary-600` | `#1D4ED8` | Hover/pressed primary |
| `--primary-700` | `#1E40AF` | Focus ring on light surfaces |

**Secondary — Care Green** (success, healthy state, "Active", "Repeat" tags)

| Token | Hex | Use |
|-------|-----|-----|
| `--success-50`  | `#ECFDF5` | Success toast background |
| `--success-100` | `#D1FAE5` | "Repeat" / "Active" tag bg |
| `--success-500` | `#10B981` | Success icon, delivered status |
| `--success-700` | `#047857` | Success text on light bg |

### 2.2 Semantic Status Colors

| Status | Token | Hex | Where it appears |
|--------|-------|-----|------------------|
| Info / pending | `--info` | `#0EA5E9` | "Scheduled", reminder pending |
| Warning | `--warning` | `#F59E0B` | Approaching rate limit, near opt-out threshold |
| Danger | `--danger` | `#EF4444` | Failed sends, bounces, suspension risk |
| High-value | `--accent-gold` | `#D97706` | "High Value" / "High Spender" tags only |

### 2.3 Neutrals (Surface & Text)

| Token | Hex | Use |
|-------|-----|-----|
| `--bg` | `#FFFFFF` | App background |
| `--surface` | `#F8FAFC` | Card background, secondary panels |
| `--surface-hover` | `#F1F5F9` | Row hover |
| `--border` | `#E2E8F0` | Default border, divider |
| `--border-strong` | `#CBD5E1` | Inputs, focus-adjacent |
| `--text` | `#0F172A` | Primary text |
| `--text-muted` | `#475569` | Secondary text, helper labels |
| `--text-subtle` | `#94A3B8` | Timestamps, metadata |

### 2.4 Tag Color Mapping (auto-generated tags from PRD §2.1)

| Tag | Background | Text |
|-----|------------|------|
| New | `--primary-100` | `--primary-700` |
| Repeat | `--success-100` | `--success-700` |
| High Value | `#FEF3C7` | `#92400E` |
| Inactive | `#F1F5F9` | `#475569` |
| Chronic | `#EDE9FE` | `#5B21B6` |
| OptOut | `#FEE2E2` | `#991B1B` |

> **Rule:** No new tag colors without product approval. Six is the cap.

### 2.5 shadcn/ui CSS Variable Mapping

Drop into `globals.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 210 40% 98%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 221 83% 53%;          /* Trust Blue 500 */
  --primary-foreground: 0 0% 100%;
  --secondary: 152 76% 95%;        /* Care Green 100 */
  --secondary-foreground: 158 64% 24%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 213 94% 95%;           /* Primary 50 */
  --accent-foreground: 224 76% 33%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 221 83% 53%;             /* Trust Blue 500 */
  --radius: 0.625rem;
}
```

> **Dark mode:** Out of scope for V1 (per "Speed > Perfection" — Rule 11). Stub variables only; ship light theme.

---

## 3. Typography

**Font stack:** `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
*(Rationale: free, transliteration-ready for Hindi roadmap, excellent at small UI sizes.)*

### Type Scale (desktop)

| Token | Size / Line | Weight | Use |
|-------|-------------|--------|-----|
| `text-display` | 30 / 36 | 600 | Dashboard header only |
| `text-h1` | 24 / 32 | 600 | Page title |
| `text-h2` | 20 / 28 | 600 | Card section title |
| `text-h3` | 16 / 24 | 600 | Customer name in profile card |
| `text-body` | 14 / 20 | 400 | Default body |
| `text-label` | 13 / 18 | 500 | Form labels, table headers |
| `text-caption` | 12 / 16 | 400 | Timestamps, helper text |
| `text-mono` | 13 / 20 | 500 (mono) | Phone, bill IDs, amounts |

**Mobile:** scale body to 15/22 to maintain readability without zoom.

**Numerals:** use `font-variant-numeric: tabular-nums` on all currency, counts, and timestamps — keeps dashboard cards from jittering as values update.

---

## 4. Spacing, Radius, Elevation

### Spacing (4px base)
`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`

| Context | Spacing |
|---------|---------|
| Card padding | 24 (desktop), 16 (mobile) |
| Section gap | 32 |
| Form field vertical gap | 16 |
| Inline icon ↔ text | 8 |

### Radius

| Token | Value | Use |
|-------|-------|-----|
| `radius-sm` | 6px | Inputs, tags, chips |
| `radius-md` | 10px | Buttons, small cards |
| `radius-lg` | 14px | Primary cards, dashboard tiles |

### Elevation (use sparingly — rule: at most one elevated layer per screen)

| Token | Shadow |
|-------|--------|
| `shadow-card` | `0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)` |
| `shadow-popover` | `0 8px 24px rgba(15, 23, 42, 0.08)` |
| `shadow-modal` | `0 24px 48px rgba(15, 23, 42, 0.18)` |

---

## 5. Component Patterns

### 5.1 Buttons

| Variant | Style | When |
|---------|-------|------|
| **Primary** | Solid `--primary-500`, white text | One per screen — "Send", "Save", "Create Customer" |
| **Secondary** | White bg, `--border-strong` outline, `--text` | "Cancel", non-dominant action |
| **Ghost** | No bg, `--text-muted` | Tertiary actions in tables/cards |
| **Destructive** | Solid `--danger`, white text | "Delete", "Remove opt-in" — confirmation always required |
| **Success-pill** | `--success-100` bg, `--success-700` text | Status confirmations only, never as CTA |

**Sizes:** `sm 32px · md 40px · lg 48px`. Mobile defaults to `lg` for 44px touch target compliance (Rule 12).

### 5.2 Cards

Two card patterns only — resist inventing more.

1. **Metric Card** (Dashboard tiles)
   - Title (caption, muted) → Value (display) → Delta line (success/danger w/ arrow)
   - Single value, no charts (per PRD §2.8 "minimal charts")

2. **Entity Card** (Customer, Campaign, Reminder)
   - Title row: name + status tag (right)
   - Meta row: 2–3 muted facts max (last visit, total spend, frequency)
   - Action row: 1 primary action + overflow menu (`⋯`)

### 5.3 Forms

- **Field height:** 40px desktop, 48px mobile
- **Label position:** above input, never floating (predictability > novelty)
- **Required marker:** `*` in `--danger`
- **Helper text:** below input, `--text-muted`, 12px
- **Error state:** border `--danger`, helper text `--danger`, no shake animation
- **Phone field:** always shows `+91` prefix locked; phone is primary key per PRD §2.1
- **Max fields per form:** 6 visible. Overflow → progressive disclosure ("Add more details ▾")

### 5.4 Tables / Lists

- **Row height:** 56px (touch-comfortable, scannable)
- **Hover:** `--surface-hover`, full-row clickable to open profile
- **Sticky header:** background `--surface`, border-bottom `--border`
- **Empty state:** illustration-free; one-line message + primary CTA (e.g., "No customers yet. + Add your first customer")
- **Pagination:** desktop only; mobile uses infinite scroll

### 5.5 Tags / Chips

- Pill shape, `radius-sm`, 12px text, 500 weight
- Padding: 4px vertical / 10px horizontal
- Color mapping per §2.4 — never freestyle

### 5.6 Activity Timeline (PRD §2.7)

- Vertical line on left (1px `--border`), event dots colored by event type:
  - Bill → `--primary-500`
  - Message → `--info`
  - Reminder → `--accent-gold`
  - Note → `--text-muted`
  - Tag/contact change → `--text-subtle`
- Each entry: timestamp (caption, muted) → 1-line headline → optional details (collapsed by default)

### 5.7 WhatsApp Send Surface (highest-stakes UI)

Per Rules §3 and §9, this surface must visibly enforce constraints:

- **Rate-limit meter:** persistent chip in send composer, e.g., `7 / 10 sent this hour` — turns warning amber at 8, danger red at 10
- **Bulk-send threshold guard:** modal blocker when count > 100 ("Manual approval required" — admin only)
- **Opt-out badge:** if recipient is OptOut, send button disabled with inline explanation
- **Schedule defaults:** send window 9 AM – 8 PM hard-locked in time picker

> **Theme rule:** Constraints are part of the visual language, not error states. Show them at rest, not just on failure.

---

## 6. Iconography

- **Library:** `lucide-react` (ships with shadcn/ui — no new dependency)
- **Stroke:** 1.5px
- **Size:** 16px inline, 20px buttons, 24px nav
- **Color:** inherits text color; never standalone-colored except status icons

**Reserved icons (consistent meaning across app):**

| Concept | Icon |
|---------|------|
| Message sent | `Send` |
| Bill / receipt | `Receipt` |
| Reminder | `Bell` |
| Customer | `User` |
| Campaign | `Megaphone` |
| Repeat / refill | `RotateCw` |
| Opt-out | `BellOff` |

---

## 7. Motion

Minimal by design (Rule 8 — simplicity).

| Animation | Duration | Easing |
|-----------|----------|--------|
| Hover/press | 120ms | `ease-out` |
| Modal/sheet enter | 180ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Toast | 200ms slide+fade | `ease-out` |
| Skeleton shimmer | 1200ms loop | linear |

**No:** parallax, decorative loops, scroll-triggered reveals, marketing-style transitions.

---

## 8. Accessibility

- **Contrast:** all text/icon combinations ≥ WCAG AA (4.5:1 body, 3:1 large). Trust Blue 500 on white = 5.8:1. ✓
- **Focus ring:** 2px `--primary-700` with 2px offset — visible on every interactive element
- **Touch targets:** ≥ 44×44 px on mobile (Rule 12)
- **Form errors:** announced via `aria-live="polite"`, never color-only
- **Plain language:** all error and helper text passes the "50-year-old pharmacist" test (Rule 5)

---

## 9. Density Modes

| Mode | Use | Spacing scale |
|------|-----|---------------|
| **Comfortable** *(default)* | Customer profile, forms, dashboard | base scale |
| **Compact** | Customer list, campaign history table | scale × 0.75 (rows 48px) |

No third density. Owner cannot toggle in V1 — stays simple.

---

## 10. Theme Quick-Reference (paste into design reviews)

```
Primary:     #2563EB (Trust Blue)
Success:     #10B981 (Care Green)
Danger:      #EF4444
Warning:     #F59E0B
Surface:     #F8FAFC
Text:        #0F172A
Border:      #E2E8F0
Font:        Inter, system-ui
Radius:      6 / 10 / 14
Base spacing: 4px (4·8·12·16·24·32·48·64)
Components:  shadcn/ui only — no custom forks
Density:     Comfortable default; Compact for tables
Motion:      120–200ms, ease-out, no decorative
Touch:       ≥44px on mobile
```

---

## 11. Theme Acceptance Checklist (every screen)

- [ ] One dominant primary CTA — no competing primaries
- [ ] Tags use only the six approved colors
- [ ] Numbers use tabular-nums
- [ ] Mobile touch targets ≥ 44px
- [ ] Focus ring visible on all interactive elements
- [ ] No charts beyond simple bars/numbers (PRD §2.8)
- [ ] Visible WhatsApp constraints if messaging surface
- [ ] Plain-language labels (no jargon)
- [ ] Uses shadcn/ui components, not custom replacements

> Failing any item = redesign before code (Rule 17).

---

## Document Info
**Theme Version:** 1.0
**Aligned with:** Medstocksy Connect PRD v1.0, Agent Rules v1.0
**Status:** Ready for implementation
**Owner:** Medstocksy Design + Product
