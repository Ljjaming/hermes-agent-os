# Airtable Schema — Revenue Leak Pipeline

This is the data substrate for the entire pipeline. Every agent writes here. Every Make.com scenario triggers off rows here. The Queue tab in Hermes Agent OS reads from here. The forcing-function snapshots aggregate from here.

Four tables. Build them in the order below. You can ship Phase 1 with just **Prospects** and **ApprovalQueue**, the other two are wired in Phase 1.5.

---

## How the tables relate

```
Prospects (1) ─────< Conversations (many)
   │
   ├──< Audits (many, usually one)
   │
   └──< ApprovalQueue (many)
```

Every Conversation, Audit, and Queue item links back to a Prospect. ApprovalQueue items can also link to a specific Conversation or Audit they pertain to.

---

## Table 1: `Prospects`

The master record. Every potential audit client lives here at exactly one stage at any moment.

### Fields

| Field | Type | Options / Notes |
|---|---|---|
| `business_name` | Single line text | Primary field |
| `website_url` | URL | |
| `sector` | Single line text | "Med spa," "B2B SaaS," etc. |
| `monthly_revenue_range` | Single select | Under $10k / $10-25k / $25-50k / $50-100k / $100-250k / $250k+ / Unknown |
| `team_size` | Single select | Solo / 2-5 / 6-10 / 11-25 / 25+ / Unknown |
| `tools_in_use` | Multiple select | Stripe, PayPal, GoHighLevel, HubSpot, Pipedrive, Salesforce, Calendly, Cal.com, Fathom, Otter, Tally, Typeform, Make.com, Zapier, n8n, ClickUp, Notion, Airtable, Mailchimp, ConvertKit, ActiveCampaign, Klaviyo, Instantly, Smartlead, Lemlist, Webflow, Wix, WordPress, Shopify, Other |
| `discovery_source` | Single select | scout, referral, inbound, social, manual, other |
| `stage` | Single select | discovery, research, hook, outreach_drafted, sent, responded, booked, paid, in_audit, delivered, archived, declined |
| `hook` | Long text | One-sentence diagnosis from Diagnostician |
| `outreach_draft` | Long text | Latest draft from Outreach |
| `outreach_sent_at` | Date and time | Set when SENT stage reached |
| `reply_received_at` | Date and time | |
| `reply_classification` | Single select | interested, objection, deferral, refusal, ghost, n/a |
| `call_booked_at` | Date and time | |
| `payment_received_at` | Date and time | |
| `audit_delivered_at` | Date and time | |
| `assigned_agent` | Single select | hermes, diagnostician, researcher, outreach, auditor, strategist, archive, none |
| `intake_form_url` | URL | Tally response URL for this prospect |
| `intake_data` | Long text | Pasted intake data, used by Auditor as the INTAKE: block |
| `transcript_url` | URL | Fathom link |
| `screen_recording_url` | URL | Loom link |
| `notes` | Long text | Justin's free-text notes |
| `last_activity_at` | Last modified time | Auto |
| `created_at` | Created time | Auto |
| `conversations` | Link to another record → Conversations | |
| `audits` | Link to another record → Audits | |
| `approval_items` | Link to another record → ApprovalQueue | |

### Views

| View name | Filter | Group / Sort |
|---|---|---|
| **Active Pipeline** | stage is not (archived, declined) | Group by stage; sort by last_activity_at desc |
| **Awaiting Reply** | stage = sent AND outreach_sent_at older than 7 days AND reply_received_at is empty | Sort by outreach_sent_at asc |
| **Booked Calls** | stage = booked OR stage = paid | Sort by call_booked_at asc |
| **Paid, Audit Pending** | stage = paid AND audit_delivered_at is empty | Sort by payment_received_at asc |
| **This Week's Sent** | outreach_sent_at within last 7 days | Sort by outreach_sent_at desc |
| **By Source** | (all) | Group by discovery_source |
| **Archive** | stage = archived OR stage = declined | Sort by last_activity_at desc |

---

## Table 2: `ApprovalQueue`

Every pending action that needs your one-click decision. This is what the Queue tab in Hermes Agent OS displays.

### Fields

| Field | Type | Options / Notes |
|---|---|---|
| `title` | Single line text | Primary field, e.g., "Outreach to Acme Med Spa" |
| `type` | Single select | outreach_send, reply_send, audit_deliverable, content_post, reply_classification |
| `prospect` | Link to another record → Prospects | Optional (content posts have no prospect) |
| `related_conversation` | Link to another record → Conversations | Optional |
| `related_audit` | Link to another record → Audits | Optional |
| `draft_content` | Long text | The actual draft to approve |
| `preview_summary` | Formula | `LEFT({draft_content}, 200) & "..."` |
| `agent_source` | Single select | hermes, diagnostician, researcher, outreach, auditor, strategist, archive, content |
| `status` | Single select | pending, approved, edited, killed, expired |
| `priority` | Single select | normal, high, urgent |
| `created_at` | Created time | Auto |
| `decided_at` | Date and time | |
| `decision_by` | Single select | justin, auto, expired |
| `final_content` | Long text | What was actually sent / shipped (may differ from draft if edited) |
| `time_pending_hours` | Formula | `IF({decided_at}, DATETIME_DIFF({decided_at}, {created_at}, 'hours'), DATETIME_DIFF(NOW(), {created_at}, 'hours'))` |
| `age_status` | Formula | `IF({status} != "pending", "decided", IF({time_pending_hours} > 36, "overdue", IF({time_pending_hours} > 12, "aging", "fresh")))` |

### Views

| View name | Filter | Group / Sort |
|---|---|---|
| **Pending (all)** | status = pending | Sort by time_pending_hours desc |
| **Overdue** | status = pending AND age_status = overdue | Sort by time_pending_hours desc |
| **By Type** | status = pending | Group by type |
| **Decided History** | status != pending | Sort by decided_at desc |
| **Outreach to Approve** | status = pending AND type = outreach_send | Sort by created_at asc |
| **Audits to Review** | status = pending AND type = audit_deliverable | Sort by priority desc, created_at asc |

---

## Table 3: `Conversations`

Every inbound and outbound message exchanged with a prospect. Used by Outreach and Inbox agents.

### Fields

| Field | Type | Options / Notes |
|---|---|---|
| `subject` | Single line text | Primary field, derived from content if no real subject |
| `prospect` | Link to another record → Prospects | Required |
| `direction` | Single select | outbound, inbound |
| `channel` | Single select | email, instagram_dm, linkedin, sms, other |
| `content` | Long text | Full message body |
| `sent_at` | Date and time | |
| `received_at` | Date and time | For inbound |
| `agent_drafted` | Single select | outreach, hermes, none |
| `requires_approval` | Checkbox | True for outbound that haven't been approved yet |
| `approved` | Checkbox | |
| `approved_at` | Date and time | |
| `classification` | Single select | (inbound only) interested, objection, deferral, refusal, ghost, n/a |
| `thread_id` | Single line text | Email Message-ID or DM thread reference |
| `created_at` | Created time | Auto |

### Views

| View name | Filter | Sort |
|---|---|---|
| **Recent** | (all) | created_at desc |
| **Outbound Pending Send** | direction = outbound AND requires_approval = true AND approved = false | created_at asc |
| **Inbound Unclassified** | direction = inbound AND classification is empty | received_at desc |

---

## Table 4: `Audits`

Every paid audit and its deliverable artifacts.

### Fields

| Field | Type | Options / Notes |
|---|---|---|
| `client_name` | Single line text | Primary field |
| `prospect` | Link to another record → Prospects | Required |
| `payment_received_at` | Date and time | |
| `intake_received_at` | Date and time | When Tally form was submitted |
| `transcript_url` | URL | |
| `screen_recording_url` | URL | |
| `draft_generated_at` | Date and time | When Auditor produced the draft |
| `draft_content` | Long text | The 70% draft, full text |
| `review_started_at` | Date and time | |
| `delivered_at` | Date and time | |
| `loom_url` | URL | The recording shipped to client |
| `one_pager_url` | URL | Notion / Drive link |
| `five_gap_scorecard` | Long text | Extracted structured scores |
| `biggest_leak` | Long text | The named leak |
| `dollar_estimate_low` | Number | Currency, conservative bound |
| `dollar_estimate_likely` | Number | Currency, likely figure |
| `confidence` | Single select | low, medium, high |
| `audit_status` | Single select | pending_intake, intake_received, draft_generated, in_review, delivered, refunded |
| `created_at` | Created time | Auto |

### Views

| View name | Filter | Sort |
|---|---|---|
| **Active Audits** | audit_status is not (delivered, refunded) | Sort by payment_received_at asc |
| **Awaiting Intake** | audit_status = pending_intake | payment_received_at asc |
| **Awaiting Draft** | audit_status = intake_received | intake_received_at asc |
| **In Review** | audit_status = in_review | draft_generated_at asc |
| **Delivered** | audit_status = delivered | delivered_at desc |
| **All by Confidence** | (all) | Group by confidence |

---

## Setup instructions

### 1. Create the base

1. airtable.com → log in → **Add a base** → **Start from scratch**
2. Name the base: **Revenue Leak Pipeline**
3. Rename the default first table to `Prospects`
4. Add the fields per Table 1 above. Use exact field names (lowercase with underscores) so Make.com and the Worker can reference them directly.
5. Create the views for Prospects.
6. Add tables 2-4 in order. For each linked field, link to the correct other table.

### 2. Create a Personal Access Token

1. airtable.com/create/tokens → **Create new token**
2. Name: `Hermes Agent OS — Phase 1`
3. Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
4. Access: select your Revenue Leak Pipeline base only
5. **Copy the token**, store it in your password manager. It is shown once.

### 3. Get your base ID and table IDs

Open any table in the base. The URL shows:
```
https://airtable.com/appXXXXXXXXXXXX/tblYYYYYYYYYYYY/viwZZZZZZZZZZZZ
```
- `appXXX...` is the base ID
- `tblYYY...` is the table ID for the open table
- `viwZZZ...` is the view ID

Record these somewhere I can reference them when wiring Make.com and the Worker.

### 4. Connect to Make.com

In Make.com → Connections → **Add new** → **Airtable** → paste your Personal Access Token. Make.com will then let any scenario read/write to your tables.

### 5. Connect to the Agent Runtime (Cloudflare Worker, Phase 1.5)

When the Worker is built, you'll paste the PAT into the Worker's environment variable `AIRTABLE_TOKEN` via the Cloudflare dashboard. The Worker uses it to write Auditor outputs and ApprovalQueue rows directly.

---

## Phase 1 minimum to start

If you do not want to build the whole schema today, build only these:

1. **Prospects table** with all fields
2. **ApprovalQueue table** with all fields
3. The two views per table marked **Active Pipeline** and **Pending (all)**

Skip Conversations and Audits for now. You can paste raw conversation text into the `notes` field on Prospects, and the draft deliverable into the `intake_data` field, until Phase 1.5 ships those tables.

This minimum gets you to the point of "Auditor drafts an audit, ApprovalQueue surfaces it, you approve, you ship" without needing the full schema.

---

## Why this schema, in one sentence each

- **Prospects** carries the entire pipeline state on one row so any agent or scenario can read where a prospect is and what's next.
- **ApprovalQueue** is the single source of truth for "what does Justin need to decide today," surfaced in the Queue tab and the daily snapshot.
- **Conversations** preserves the message history so Outreach and Inbox have context for follow-ups without re-fetching from email.
- **Audits** isolates the paid-delivery artifacts so they can be queried, billed against, and analyzed independently of pipeline noise.
