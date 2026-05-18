# Medstocksy Connect – Pharmacy CRM PRD

## 1. Product Overview

### Definition
**Medstocksy Connect** is a lightweight CRM layer built on top of pharmacy inventory management, designed specifically for repeat customer engagement through WhatsApp and automated reminders.

### Core Thesis
1. Pharmacies don't need traditional "CRM"
2. They need repeat customers + reminders + simple communication
3. WhatsApp = primary channel for customer reach
4. Automation = staff time savings

### Goals
- **Increase repeat purchases** by 20–30%
- **Reduce manual follow-ups** by 80%
- **Staff learning curve** < 10 minutes
- **Time to first message** < 2 minutes after billing

---

## 2. Core Modules (MVP)

### 2.1 Customer Management

**Purpose:** Single source of truth for every customer.

**Features:**
- Add/Edit customer manually
- Auto-create customer on billing
- Duplicate detection via phone number
- Customer profile view with full history

**Core Fields:**
- Name (required)
- Phone number (required, primary key)
- Age (optional)
- Gender (optional)
- Address (optional)
- Tags (manual + auto-generated)

**Smart Logic:**

| Condition | Action | Tag |
|-----------|--------|-----|
| 2+ purchases | Auto-tag | "Repeat" |
| Total spend > ₹10,000 | Auto-tag | "High Value" |
| >30 days since last visit | Auto-tag | "Inactive" |
| First purchase | Auto-tag | "New" |
| Chronic medicine buyer | Manual tag | "Chronic" |

**Customer Profile Card:**
```
Name: Ramesh Singh
Phone: +91-9876543210
Age: 45 | Gender: Male
Last Visit: 2 days ago
Total Spend: ₹15,420
Purchases: 12
Tags: Repeat, High Value, Chronic
Status: Active
```

---

### 2.2 Billing → CRM Sync

**Purpose:** Turn every sale into CRM data automatically.

**Auto-Capture Data:**
- Medicines purchased (list)
- Bill value
- Date & time
- Payment method
- Discounts applied

**Link with Customer Profile:**
- Automatic customer identification
- Bill added to customer timeline
- Derived metrics updated

**Derived Data (Auto-calculated):**
- Last purchase date
- Purchase frequency (days)
- Monthly average spend
- Purchase pattern (e.g., "buys every 25 days")
- Most frequent medicines
- Total lifetime value

**Example:**
```
Customer: Priya Sharma
Last 3 Bills:
1. May 4: ₹2,150 (Vitamins, Pain relief)
2. April 28: ₹1,890 (Antibiotics, Cough syrup)
3. April 10: ₹3,200 (BP meds, Vitamins)

Frequency: Every 17 days (average)
Monthly spend: ~₹7,500
Pattern: Regular buyer, high consistency
```

---

### 2.3 WhatsApp Communication (Critical Engine)

**Reality Check:** Cannot bypass WhatsApp restrictions long-term. Focus on compliance + human-like sending patterns.

**Features:**

1. **Send Bill Copy**
   - Automatic after billing
   - Manual option available
   - Include: Bill no., items, total, date

2. **Send Thank-You Message**
   - Post-purchase
   - Customizable template
   - Optional discount offer

3. **Custom Messages**
   - One-off messaging
   - Manual compose
   - Compliance check before send

4. **Bulk Messaging (Controlled)**
   - Segment-based
   - Template selection
   - Send/Schedule option
   - Rate limiting built-in

**Message Templates (Pre-built):**

**Template 1: Thank You**
```
Hi {customer_name}, 

Thank you for shopping at {pharmacy_name}! 
Your bill ({bill_amount}) has been saved to our system.

For refills, call or visit us anytime.
```

**Template 2: Refill Reminder**
```
Hi {customer_name}, 

Time to refill your {medicine_name}?
We have it in stock. 

Call: {pharmacy_phone}
Or visit our store.
```

**Template 3: Offer Message**
```
Hi {customer_name}, 

Special offer on {medicine_category}: {discount}% off!
Valid till {date}.

Limited stock. Order now.
```

**Smart Sending Rules:**

| Rule | Implementation | Purpose |
|------|----------------|---------|
| Max messages/hour | 10 per hour cap | Avoid WhatsApp blocks |
| Delay simulation | Random 2-60s between sends | Warm-up pattern |
| Opt-out tagging | Tag "OptOut" automatically | Compliance |
| Time slot | 9 AM–8 PM only | User convenience |
| Bulk limit | 500/day per account | Safety margin |

**Safety Guardrails:**
- ⚠️ Manual approval required for bulk sends >100
- ⚠️ Automatic delay between messages
- ⚠️ Monitor bounce/fail rates
- ⚠️ Opt-out list enforcement
- ⚠️ Warn if sending >100 similar messages

---

### 2.4 Automated Reminders (High ROI)

**Purpose:** Drive repeat purchases through timely, relevant reminders.

**Reminder Types:**

1. **Refill Reminders**
   - Trigger: Based on medicine purchase history
   - Frequency: Medicine-specific intervals
   - Example: BP medicine → 25-day reminder

2. **Follow-Up Reminders**
   - Trigger: Days since last purchase
   - Frequency: Configurable (7, 14, 30 days)
   - Example: No purchase in 30 days → "We miss you" message

3. **Custom Reminders**
   - Trigger: Manual or rule-based
   - Frequency: User-defined
   - Example: "Stock arrived for {medicine_name}"

**Custom Rules Engine:**

**Medicine-Based Mapping:**
```
Medicine Type          → Refill Interval → Reminder Offset
─────────────────────────────────────────────────────────
BP medicine            → 30 days        → 25 days
Diabetes medicine      → 30 days        → 25 days
Vitamins              → 60 days        → 55 days
Antibiotics           → None            → No reminder
Pain relief (as needed) → None            → No reminder
Cough syrup           → 30 days        → 25 days
```

**Rule Configuration UI:**
- Select medicine
- Set reminder interval (in days)
- Choose message template
- Enable/disable toggle

**Example Reminder Flow:**
```
1. Customer buys "Amlodipine" (BP med) on May 1
2. Auto-scheduled reminder: June 25 (25 days later)
3. On June 25 at 10 AM:
   - Check if customer already purchased
   - If not → Send WhatsApp reminder
4. Customer sees: "Time to refill your BP medicine?"
5. Customer replies or calls → Captured in timeline
```

---

### 2.5 Customer Segmentation

**Purpose:** Targeted messaging based on customer behavior.

**Pre-built Segments:**

| Segment | Criteria | Size (typical) | Use Case |
|---------|----------|---|----------|
| New Customers | 0–7 days since first purchase | 5–10% | Welcome campaigns |
| Repeat Customers | 2+ purchases | 30–40% | Loyalty offers |
| Inactive | 30+ days since last purchase | 15–20% | Win-back campaigns |
| High Spenders | Monthly spend > ₹5,000 | 10–15% | Premium offers |
| Chronic Patients | Tag = "Chronic" | Varies | Regular refills |

**Filter Options (Combined):**
- Last visit date (range)
- Total spend (min/max)
- Purchase frequency (min/max)
- Tags (multi-select)
- Medicines (multi-select)
- Age (range)
- Gender

**Segment Preview:**
```
Segment: "Inactive Customers"
Filters: 
  - Last visit: 30+ days ago
  - Total purchases: 2+

Results: 47 customers
Sample: Rajesh (45 days), Priya (35 days), Amit (60 days)
```

---

### 2.6 Campaigns

**Purpose:** Run targeted promotions with minimal friction.

**Campaign Flow:**

1. **Select Segment**
   - Choose pre-built or custom segment
   - Preview customer list
   - Confirm selection

2. **Choose Template**
   - Select from pre-built messages
   - Or customize (plain text)
   - Preview with sample customer name

3. **Schedule/Send**
   - Send now (subject to rate limits)
   - Schedule for later
   - Choose time slot

4. **Metrics (Basic)**
   - Sent count
   - Failed count
   - Failure reasons (if any)

**Campaign Card (Post-send):**
```
Campaign: "May Discount - Vitamins"
Segment: High Spenders
Sent: May 10, 2:30 PM

Results:
├─ Sent: 45 ✓
├─ Failed: 2 ✗
├─ Bounced: 0
└─ Response Rate: Tracking available

Template: Offer Message
Message: "Special offer on vitamins: 20% off!"
```

**Campaign History:**
- View all past campaigns
- Re-run successful campaigns
- Edit and re-send
- Download report

---

### 2.7 Activity Timeline (Underrated but Powerful)

**Purpose:** Complete customer interaction history in one place.

**Timeline Events:**

| Event Type | Data | Timestamp |
|-----------|------|-----------|
| Bill Created | Bill ID, amount, medicines | Auto |
| Message Sent | Message type, template, status | Auto |
| Reminder Triggered | Reminder type, medicine, status | Auto |
| Customer Note | Note text, added by | Manual |
| Tag Changed | Old/new tags, changed by | Auto |
| Contact Updated | Field changes, changed by | Manual |
| Opt-out Status | Status change, reason | Auto/Manual |

**Timeline View (Customer Profile):**
```
PRIYA SHARMA – Activity Timeline
────────────────────────────────

May 5, 2:15 PM
✓ Message sent: "Thank you for your purchase"
  Status: Delivered

May 5, 2:05 PM
🛒 Bill created: #INV-5847 (₹2,150)
   Items: Vitamins (2), Cough syrup (1)

Apr 28, 1:30 PM
⏰ Reminder triggered: "Time to refill Cough syrup"
   Status: Sent

Apr 28, 10:30 AM
🛒 Bill created: #INV-5821 (₹1,890)
   Items: Antibiotics (1), Cough syrup (1)

Apr 20, 3:00 PM
📝 Note added: "Prefers morning calls"
   Added by: Rajesh (Staff)
```

**Impact:**
- ✅ Staff clarity on customer interactions
- ✅ Better conversations (context-aware)
- ✅ Dispute resolution (historical record)
- ✅ Personal touch (notes, preferences)

---

### 2.8 Dashboard (Simple, not Fancy)

**Purpose:** Quick overview for owner/manager.

**Key Metrics:**

1. **Total Customers**
   - All-time count
   - New this month
   - Trend (↑/↓)

2. **Repeat Customers %**
   - (Customers with 2+ purchases / Total) × 100
   - Trend vs. last month

3. **Messages Sent Today**
   - Manual sends
   - Automated sends
   - Failed count

4. **Upcoming Reminders**
   - Scheduled in next 7 days
   - Count breakdown by type

5. **Revenue (Optional)**
   - Daily sales (if billing integrated)
   - Monthly comparison
   - Top products

**Dashboard Layout:**

```
DASHBOARD
═════════════════════════════════════════

┌─────────────────┬─────────────────┬─────────────────┐
│ Total Customers │ Repeat Rate     │ Inactive %      │
│      347        │      38%        │     18%         │
│      ↑ +12      │      ↑ +3%      │      ↑ +2%      │
└─────────────────┴─────────────────┴─────────────────┘

┌─────────────────┬─────────────────┬─────────────────┐
│ Messages Today  │ Upcoming        │ Success Rate    │
│       42        │ Reminders: 23   │      98%        │
│  Manual: 15     │  Next 7 days    │   (1 failed)    │
│  Auto: 27       │                 │                 │
└─────────────────┴─────────────────┴─────────────────┘

[Quick Action Buttons]
[+ New Customer] [Send Campaign] [View Reports]
```

**Dashboard Features:**
- Real-time metric updates
- No deep dives (link to full views)
- Mobile-responsive
- Minimal charts (simple bars/numbers only)

---

## 3. UX Principles (Non-negotiable)

### 1. One-Click Actions
- Every common task = max 1–2 clicks
- No multi-step modals for quick sends
- Keyboard shortcuts for power users (desktop)

### 2. No Clutter
- Hide advanced options by default
- Progressive disclosure (expandable sections)
- Clear, scannable cards
- Whitespace > density

### 3. Desktop & Mobile Compatible
- Desktop = primary (full features)
- Mobile = companion (quick actions + read-only)
- Responsive at all breakpoints
- Touch-friendly on mobile

### 4. Hindi/English Friendly (Later)
- UI text: Simple, conversational
- Prepare for RTL + LTR flexibility
- Medicine names can be transliterated
- Error messages in plain language

### 5. Design System
- **Library:** shadcn/ui
- **Colors:** Clean, pharmacy-appropriate (blue/green)
- **Typography:** Clear hierarchy
- **Components:** Reusable, consistent
- **Forms:** Large, minimal fields
- **Buttons:** Clear primary/secondary distinction

---

## 4. User Flow (Core Loop)

This loop = product value. Every step must be frictionless.

```
1. BILL GENERATED
   └─ Staff completes sale at billing counter
   
2. CUSTOMER AUTO-CREATED (if new)
   └─ Phone number = primary key
   └─ No additional data entry needed
   
3. WHATSAPP BILL SENT (automatic)
   └─ Bill copy + "Thank you" message
   └─ Delivered within 30 seconds
   
4. REMINDER SCHEDULED (automatic)
   └─ Based on medicine type
   └─ E.g., BP med → 25-day reminder
   
5. CUSTOMER RETURNS
   └─ Sees bill from last purchase
   └─ Comes back for refill
   
6. REPEAT
   └─ New bill created
   └─ Cycle restarts
```

**Why This Works:**
- ✅ No manual CRM entry
- ✅ Automatic engagement (no follow-up work)
- ✅ Timely reminders (context-specific)
- ✅ Builds habit (repeat visit)
- ✅ Increases lifetime value

---

## 5. Roles & Permissions

### Admin (Owner)
**Access:**
- Full platform access
- Create/manage staff accounts
- View all analytics
- Create & run campaigns
- Configure reminder rules
- WhatsApp account management
- System settings

**Typical Tasks:**
- Review daily dashboard
- Launch monthly campaigns
- Monitor automation performance
- Manage staff access

### Staff (Pharmacist/Counter)
**Access:**
- Add customers
- View customer history
- Send manual messages (within limits)
- View/search customer records
- Add notes to customer profiles
- View reminders sent

**Restricted:**
- ❌ Campaign creation
- ❌ Reminder rule configuration
- ❌ User management
- ❌ System settings
- ❌ Bulk message sending (limited to pre-approved templates)

**Typical Tasks:**
- Add new customer after billing
- Send bill copy to customer
- View customer history before checkout
- Add preferences/notes

---

## 6. Tech Stack (Lean + Scalable)

| Layer | Technology | Reason |
|-------|------------|--------|
| **Frontend** | React + ShadCN | Fast iteration, component reuse |
| **Backend** | Supabase | Real-time, PostgreSQL, auth built-in |
| **Auth** | Supabase Auth | Native, JWT, easy role management |
| **Database** | PostgreSQL | ACID compliance, relational, reliable |
| **Hosting** | Vercel | Zero-config, edge functions, auto-scaling |
| **WhatsApp API** | Twilio/Meta Business API | Compliance, rate limiting, webhooks |
| **Task Scheduler** | Supabase Cron / Vercel Crons | Trigger reminders, scheduled sends |

**Why This Stack:**
- ✅ Low operational overhead
- ✅ Scales with traffic
- ✅ Can add AI/ML later
- ✅ Cost-effective for MVP
- ✅ Team familiar with stack

---

## 7. Constraints (Important)

### 1. WhatsApp Risk
- ✅ Avoid spam bursts (max 10 msgs/hour)
- ✅ Warm-up accounts (gradual ramp)
- ✅ Monitor bounce rates (>5% = alert)
- ✅ Implement opt-out immediately
- ✅ Log all sends (audit trail)
- ⚠️ Account suspension risk if non-compliant

### 2. Data Simplicity
- ✅ Don't over-engineer
- ✅ Customer = phone + name + history
- ✅ No complex profiles
- ✅ Avoid unnecessary data fields
- ✅ Focus on actionable data only

### 3. Speed > Perfection
- ✅ Launch with core features only
- ✅ Iterate based on user feedback
- ✅ Performance > polish
- ✅ Ship fast, refine often
- ✅ Don't wait for perfect analytics

---

## 8. V1 Scope (Be Strict)

### ✅ Include in MVP:
- Customer database (add/edit/search)
- Automatic customer creation on billing
- WhatsApp message sending (manual + template)
- Pre-built message templates
- Automated reminders (medicine-based)
- Custom reminder rules engine
- Customer segmentation (basic)
- Campaign send (simple)
- Activity timeline
- Simple dashboard
- Role-based access (Admin/Staff)

### ❌ Exclude from V1:
- Advanced analytics (retention rates, cohort analysis)
- AI recommendations (send time optimization)
- Multi-store management
- Loyalty points system
- Doctor integration
- Voice calling
- SMS channel
- API for external integrations
- Custom report builder
- Mobile app (web-responsive only)

---

## 9. Future Add-ons (V2+)

### V2 Features:
1. **AI Reminder Optimization**
   - Best time to send (per customer)
   - Predictive churn (identify at-risk customers)
   - Personalized recommendations

2. **Voice Calling Integration**
   - Outbound calls for urgent reminders
   - Call tracking & logging
   - IVR for simple confirmations

3. **Loyalty Points System**
   - Points on purchase
   - Redeem for discounts
   - Tier-based benefits

4. **Doctor Integration** (Long-term)
   - Prescription sync
   - Digital records
   - Referral tracking

5. **SMS Channel**
   - Fallback if WhatsApp fails
   - Premium messages
   - Higher compliance burden

6. **Advanced Analytics**
   - Cohort analysis
   - Retention curves
   - Revenue attribution
   - Customer lifetime value

---

## 10. Positioning (Use Everywhere)

### ❌ NOT This:
- "Pharmacy CRM"
- "Customer management system"
- "Business intelligence platform"

### ✅ Say This:
**"Customer repeat system for pharmacies"**

### Positioning Statement:
```
For: Pharmacy owners & staff
Who: Want more repeat customers without manual work
What: Medstocksy Connect
Is: A lightweight system that automatically reminds customers 
    to refill their medicines via WhatsApp
Unlike: Traditional CRMs (too complex, not pharmacy-specific)
Because: Pharmacies have 100+ customers, need simple 
         automation, and WhatsApp is where customers are
```

### Elevator Pitch:
```
"Every pharmacy customer should come back.
Medstocksy Connect reminds them automatically—
no manual follow-up, no CRM learning curve.
One bill, one message, repeat customer."
```

---

## 11. Success Metrics (Track Post-Launch)

### Primary Metrics:
- Repeat customer rate (target: +20–30%)
- Messages sent per day (scale indicator)
- Campaign success rate (>85% delivery)
- Staff adoption (>80% using daily)
- Reminder conversion (customers who purchase after reminder)

### Secondary Metrics:
- WhatsApp opt-out rate (<5%)
- Message failure rate (<3%)
- Average response time (staff)
- New customers per month
- Revenue lift (if billing integrated)

---

## 12. Launch Timeline (Rough)

| Phase | Timeline | Deliverables |
|-------|----------|--------------|
| Design + Setup | Week 1–2 | Wireframes, DB schema, API design |
| Core Development | Week 3–5 | Customer DB, billing sync, WhatsApp |
| Reminders & Campaigns | Week 6–7 | Rules engine, scheduling, UI |
| Testing & Refinement | Week 8–9 | QA, WhatsApp compliance, edge cases |
| Closed Beta | Week 10–11 | 5–10 pharmacy partners, feedback loop |
| V1 Launch | Week 12 | Public release, documentation, support |

---

## 13. Risk Mitigation

### Risk: WhatsApp Account Suspension
- **Mitigation:** Gradual warm-up, rate limiting, opt-out compliance
- **Monitor:** Daily bounce rate & suspension risk
- **Fallback:** SMS channel (future), in-app notifications

### Risk: Low Staff Adoption
- **Mitigation:** <10-minute onboarding, one-click actions, training video
- **Monitor:** Usage metrics, gather feedback early
- **Fallback:** Offer staff incentives tied to repeat customers

### Risk: Data Quality Issues
- **Mitigation:** Duplicate detection, phone validation, manual review
- **Monitor:** Customer record quality audits
- **Fallback:** Manual cleaning tools for staff

### Risk: Billing Sync Failures
- **Mitigation:** Idempotent design, error logging, manual create customer
- **Monitor:** Sync error logs, data reconciliation
- **Fallback:** Manual customer creation always available

---

## Document Info
**PRD Version:** 1.0  
**Product:** Medstocksy Connect  
**Created:** 2025  
**Status:** Ready for Development  
**Owner:** Medstocksy Team
