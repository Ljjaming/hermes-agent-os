# Revenue Leak Scout

Auto-sources local med spa prospects in Tampa-St. Pete via the Google Places API, holds them for human approval, then runs analysis and outreach drafting **only after approval**. Designed to make market contact easier, not to spam prospects.

---

## 1. Purpose and rationale

The current bottleneck is market contact. Manual sourcing from Google Maps takes 20-30 minutes per 25 prospects. Across 50 prospects per week that is roughly 60-90 minutes of pure copy-pasting before any analysis or outreach happens.

The Scout endpoint compresses that to 4-8 seconds per query, leaving you with two human steps: (1) approve which prospects are worth pursuing, (2) approve the drafted outreach in the Queue. Everything between is automated.

### Why Google Places API as the default source

| Source | Cost | Signal density for med spas | Notes |
|---|---|---|---|
| **Google Places API (New)** | $200/mo free credit through Feb 28 2025, then pay-as-you-go | High | Verified businesses, current data, website + phone + rating + review count, dedupable by place_id. Pro field mask is ~$0.005 per place. $200 credit covers ~10,000+ Pro lookups. |
| Apify Google Maps Scraper | $1.50 per 1,000 results | High | Equivalent data but unofficial. Risk of rate limiting or schema changes. Use if exhausting Google credit. |
| SerpAPI | $25 for 1,000 searches on the starter plan | Medium | Returns Google Maps results but with less detail per place. Useful for breadth not depth. |
| Yelp Fusion API | Free, rate-limited | Medium | Good fallback for service businesses. Less coverage than Google in many metros. |
| Manual Google Maps copy-paste | Free | High (you choose) | Slow. Reserve for the first 25 to validate the offer-vertical fit. |

Default is the Google Places API because of the free monthly credit, the highest-quality field set (website, phone, rating, review count, business status), and the stable `place_id` for deduplication.

### Why hold for human approval

Auto-routing every sourced prospect into analysis and outreach is what makes a sourcing pipeline turn into a spam machine. The Scout endpoint creates Discovery rows in `pending` state and stops. Justin reviews 10-30 rows per session and promotes the fits. Bad fits never consume an LLM call, never receive an email, never enter the funnel.

This costs you ~10 minutes per Scout run and prevents the larger cost of sending generic outreach to the wrong people.

---

## 2. Data flow diagram

```
[Manual or scheduled trigger]
         │
         ▼
POST /source-prospects {vertical, metro, max_results}
         │
         ▼
Google Places API (textSearch + field mask)
         │
         ▼
Dedup against Airtable Prospects (place_id, website_url)
         │
         ▼
Batch insert into Prospects table:
  stage = "discovery"
  approval_status = "pending"
         │
         ▼
    [STOP. Manual approval gate #1.]
         │
         ▼
Justin opens Airtable "Discovery Pending" view
Promotes each row to approved or killed
         │
         ▼
Airtable webhook fires on approval_status = "approved"
         │
         ▼
Make.com calls POST /analyze-from-url
         │
         ▼
Worker captures screenshot, runs vision analysis
Writes back to Prospects.notes, sets stage = "hook"
         │
         ▼
Airtable webhook fires on stage = "hook" with hook field populated
         │
         ▼
Make.com calls POST /draft-outreach with screenshot_analysis
         │
         ▼
Outreach draft created in ApprovalQueue
         │
         ▼
    [STOP. Manual approval gate #2.]
         │
         ▼
Justin opens Hermes Agent OS Queue
Approves, edits, or kills each draft
         │
         ▼
Approved drafts sent via Instantly per existing Make.com scenario
```

Two stops. Everything else is automated.

---

## 3. Airtable schema additions

Add these fields to the existing **Prospects** table. Defined in `docs/AIRTABLE_SCHEMA.md` already covers most pipeline fields; the Scout adds the following:

| Field | Type | Options / Notes |
|---|---|---|
| `approval_status` | Single select | `pending`, `approved`, `killed`, `on_hold` |
| `place_id` | Single line text | Google Places API stable ID (used for dedup) |
| `address` | Single line text | Formatted address from Google |
| `phone` | Single line text | International phone number when available |
| `rating` | Number | Google star rating, 1.0-5.0 |
| `review_count` | Number | Google review count |
| `business_status` | Single select | `OPERATIONAL`, `CLOSED_TEMPORARILY`, `CLOSED_PERMANENTLY` |
| `google_maps_url` | URL | Direct link to the Google Maps listing |
| `leak_score` | Number | 1-5, populated by `/analyze-from-url` writeback |
| `fit_score` | Number | 1-5, Justin sets during approval gate |
| `budget_signal` | Single select | `high`, `medium`, `low`, `unknown` |
| `urgency_signal` | Single select | `high`, `medium`, `low`, `unknown` |

If a field name does not match exactly, Airtable's `typecast: true` flag will accept compatible types but the field must exist. Add the fields before the first Scout run.

### Required views

Create three new views on the Prospects table:

1. **Discovery Pending**
   - Filter: `approval_status = "pending" AND stage = "discovery"`
   - Sort: `created_at desc`
   - Fields visible: business_name, website_url, rating, review_count, address, place_id, fit_score
   - **This is the daily review surface.**

2. **Approved Awaiting Analysis**
   - Filter: `approval_status = "approved" AND stage = "discovery"`
   - Sort: `last_activity_at asc`
   - Fields visible: business_name, website_url, fit_score, hook
   - Empty under normal operation, because the analysis trigger should fire within seconds of approval. Items lingering here indicate a Make.com scenario problem.

3. **Killed Archive**
   - Filter: `approval_status = "killed"`
   - Used for pattern recognition (what kinds of prospects you reject most).

---

## 4. Stage definitions (full pipeline reference)

`stage` evolves through these values:

| Stage | Meaning | Set by |
|---|---|---|
| `discovery` | Sourced, awaiting approval | `/source-prospects` |
| `research` | Approved but not yet analyzed | Manual or transition |
| `hook` | Analyzed, hook generated | `/analyze-from-url` |
| `outreach_drafted` | Outreach message in Queue | `/draft-outreach` |
| `sent` | Outreach sent to prospect | Make.com Approved Outreach scenario |
| `responded` | Reply received | `/classify-reply` |
| `booked` | Discovery call on calendar | Calendly webhook (Phase 2) |
| `paid` | Stripe checkout completed | Stripe webhook |
| `in_audit` | Auditor draft in progress | `/draft-audit` |
| `delivered` | Audit shipped to client | Audit Delivery scenario |
| `archived` | Closed out (won, lost, refunded) | Manual |
| `declined` | Killed before sending | Manual |

`approval_status` runs perpendicular to stage and gates the discovery → research transition.

---

## 5. Two manual approval gates

### Gate 1: Discovery review (Airtable)

**Where:** Airtable Prospects table, "Discovery Pending" view
**When:** Daily, 10-20 minute session in the morning
**What:** For each pending row, decide one of three:
- **Approve** → set `approval_status = "approved"`. Optionally fill in initial `fit_score` (1-5).
- **Kill** → set `approval_status = "killed"`. Prospect archived.
- **Hold** → set `approval_status = "on_hold"`. Resurface later (useful for "almost a fit, check again in 30 days").

Approval triggers the Analysis Make.com scenario automatically.

### Gate 2: Outreach review (Hermes Agent OS Queue)

**Where:** Hermes Agent OS → Queue tab
**When:** Daily, 10 minutes
**What:** Each draft card has three buttons:
- **Approve** → status = "approved", Make.com sends via Instantly
- **Edit** → edit body, then approve as edited
- **Kill** → status = "killed", no send

Existing flow, documented in `docs/MAKE_COM_SCENARIOS.md` Scenario 2.

---

## 6. Scoring rules

Each prospect accumulates four scores. Two are automated, two are manual.

### `leak_score` (1-5, automated)

Populated by `/analyze-from-url` from the `analysis.overall_leak_score` field. This is what the vision model thinks about visible conversion leaks on the prospect's site.

| Score | Meaning |
|---|---|
| 5 | Critical visible leaks, likely costing 20%+ of conversion |
| 4 | High visible leaks, 10-20% impact |
| 3 | Moderate, defensible leaks |
| 2 | Minor, polished site |
| 1 | Effectively no visible leaks (site is unusually clean) |

Prospects scoring 4-5 are highest priority for outreach.

### `fit_score` (1-5, manual at Gate 1)

Justin's gut on whether this prospect fits the offer. Considers:
- Visible operational complexity (multi-service, multi-location, multi-staff)
- Buy-readiness signals (recent posts about growth, hiring)
- Friction signals (CRM mentions, scheduling complaints in reviews)

| Score | Meaning |
|---|---|
| 5 | Excellent fit, lead with this prospect |
| 4 | Strong fit, send standard outreach |
| 3 | Plausible fit, send if capacity allows |
| 2 | Weak fit, deprioritize |
| 1 | Bad fit, kill |

Kill rules: fit_score 1 or 2 → set `approval_status = "killed"`.

### `budget_signal` (single select, manual or heuristic)

| Value | What it looks like |
|---|---|
| `high` | Multiple staff visible, multiple locations, polished branding, premium service tier visible |
| `medium` | Single location, modest staffing, professional site |
| `low` | Solo operator, basic site, free booking tools only |
| `unknown` | No clear signals |

### `urgency_signal` (single select, manual or heuristic)

| Value | What it looks like |
|---|---|
| `high` | Recently hired (LinkedIn), recently launched, visible expansion signals, "we're growing" copy |
| `medium` | Regular posting cadence, recent events, active social |
| `low` | Quiet, low recent activity |
| `unknown` | No recent signals |

### Combined priority

For outreach sequencing inside the Queue, prioritize prospects with `(leak_score + fit_score) ≥ 7` and `budget_signal = high`. Lower combined scores still get outreach, just later in the week.

---

## 7. Make.com scenarios

Four scenarios make the pipeline work end-to-end. Build in dependency order.

### Scenario A: Scout (manual or scheduled)

**Trigger:** Manual webhook OR scheduled Monday 7:00 AM
**Purpose:** Fill Discovery with fresh prospects.

| Module | Config |
|---|---|
| 1. Webhook OR Schedule trigger | Webhook custom URL, or scheduled weekly |
| 2. HTTP Make a Request | URL: `https://<worker>.workers.dev/source-prospects` <br> Method: POST <br> Headers: `Content-Type: application/json`, `X-Hermes-Secret: <secret>` <br> Body: `{"vertical":"med spa","metro":"Tampa, FL","max_results":50}` |
| 3. Slack/Email notification (optional) | "Scout run: {{2.created}} new prospects added. Review in Airtable Discovery Pending." |

Total ops per run: 3.

### Scenario B: Auto-analysis on approval

**Trigger:** Airtable Watch Records on Prospects
**Purpose:** Run analysis automatically when Justin promotes a prospect.

| Module | Config |
|---|---|
| 1. Airtable Watch Records | Table: Prospects <br> Trigger Field: `approval_status` <br> Filter: `AND({approval_status}='approved', {stage}='discovery')` |
| 2. HTTP Make a Request | URL: `https://<worker>.workers.dev/analyze-from-url` <br> Method: POST <br> Headers: `Content-Type: application/json`, `X-Hermes-Secret: <secret>` <br> Body: `{"url":"{{1.fields.website_url}}","prospect_id":"{{1.id}}","business_name":"{{1.fields.business_name}}","writeback":true}` |

Total ops per approval: 2. At 50 approvals/week: 100 ops.

### Scenario C: Auto-draft outreach

**Trigger:** Airtable Watch Records on Prospects
**Purpose:** Generate outreach draft after analysis completes.

| Module | Config |
|---|---|
| 1. Airtable Watch Records | Table: Prospects <br> Trigger Field: `hook` <br> Filter: `AND({hook}!='', {stage}='hook')` |
| 2. HTTP Make a Request | URL: `https://<worker>.workers.dev/draft-outreach` <br> Method: POST <br> Headers: `Content-Type: application/json`, `X-Hermes-Secret: <secret>` <br> Body: `{"prospect_id":"{{1.id}}","business_name":"{{1.fields.business_name}}","hook":"{{1.fields.hook}}","recipient_first_name":""}` |

Total ops per draft: 2.

### Scenario D: Approved Outreach Send

Already documented in `docs/MAKE_COM_SCENARIOS.md` Scenario 2. No change. Fires when Justin approves a draft in the Queue.

---

## 8. Environment variables required

| Variable | Type | Required for | How to get |
|---|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Secret | `/source-prospects` | https://console.cloud.google.com → APIs & Services → Credentials. Enable "Places API (New)" first. $200/mo free credit. |
| `LLM_API_KEY` | Secret | All LLM endpoints | OpenRouter dashboard |
| `VISION_API_KEY` | Secret (optional) | `/analyze-screenshot`, `/analyze-from-url` | Defaults to `LLM_API_KEY` if unset |
| `SCREENSHOT_API_KEY` | Secret | `/screenshot-capture`, `/analyze-from-url` | https://screenshotone.com |
| `AIRTABLE_TOKEN` | Secret | All writeback endpoints | https://airtable.com/create/tokens |
| `SHARED_SECRET` | Secret | All routes except `/health` | Generate via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AIRTABLE_BASE_ID` | Var | All writeback endpoints | From Airtable URL |
| `LLM_ENDPOINT`, `LLM_MODEL` | Vars | Text LLM calls | Defaults set in wrangler.toml |
| `VISION_ENDPOINT`, `VISION_MODEL` | Vars | Vision calls | Defaults set in wrangler.toml |
| `SCREENSHOT_PROVIDER` | Var | Screenshot capture | Defaults to `screenshotone` |

To set the new secret:

```powershell
cd C:\Users\Justin\Documents\hermes-agent-os\worker
wrangler secret put GOOGLE_PLACES_API_KEY
# paste the key from Google Cloud Console
```

---

## 9. Endpoint reference

### `POST /source-prospects`

**Headers:** `Content-Type: application/json`, `X-Hermes-Secret: <SHARED_SECRET>`

**Request body:**

```json
{
  "vertical": "med spa",
  "metro": "Tampa, FL",
  "max_results": 50,
  "language_code": "en"
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `vertical` | yes | — | e.g., "med spa", "dental office", "law firm" |
| `metro` | yes | — | e.g., "Tampa, FL", "Scottsdale, AZ". If in METRO_BIAS table, uses location bias for tighter results. |
| `max_results` | no | 20 | Capped at 60 (Google's text search pagination ceiling) |
| `language_code` | no | "en" | ISO 639-1 |

**Response:**

```json
{
  "ok": true,
  "requested": {
    "vertical": "med spa",
    "metro": "Tampa, FL",
    "max_results": 50
  },
  "fetched": 47,
  "duplicates_skipped": 12,
  "closed_skipped": 1,
  "created": 34,
  "approval_required": true,
  "next_step": "Review new rows in Airtable Prospects 'Discovery Pending' view. Set approval_status='approved' to trigger analysis. Set approval_status='killed' to archive.",
  "prospects": [
    {
      "id": "recXXXXXXXXXXXX",
      "business_name": "Example Med Spa Tampa",
      "website_url": "https://examplemedspa.com",
      "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "address": "123 Main St, Tampa, FL 33602, USA",
      "rating": 4.7,
      "review_count": 238
    }
  ]
}
```

**Behavior:**
1. Validates `vertical` and `metro`.
2. Queries Google Places API (New) `places:searchText` with field mask for cost optimization (essentials + pro fields only).
3. Paginates up to 60 results (3 page tokens).
4. Fetches all existing `place_id` and `website_url` values from Airtable Prospects, builds dedup sets.
5. Filters fetched places against dedup sets.
6. Filters out `CLOSED_TEMPORARILY` and `CLOSED_PERMANENTLY` businesses.
7. Batch-creates remaining prospects (max 10 per Airtable API call) with `stage='discovery'` and `approval_status='pending'`.
8. Returns summary JSON.

**Does NOT trigger downstream analysis or outreach.** That is your manual approval responsibility.

---

## 10. Operating cadence

| When | What |
|---|---|
| Monday 7:00 AM | Scout runs (Make.com Scenario A). Adds ~25-50 fresh prospects to Discovery Pending. |
| Mon-Fri 8:30-8:45 AM | Justin opens Discovery Pending view. Approves 5-10 fits, kills bad ones, optionally on_hold borderline cases. |
| Within seconds of approval | Scenario B fires, `/analyze-from-url` runs, hook generated. |
| Within seconds of hook generation | Scenario C fires, `/draft-outreach` runs, draft lands in Hermes Agent OS Queue. |
| Mon-Fri 8:45-9:00 AM | Justin opens Hermes Agent OS Queue. Approves drafts. Sends via Instantly. |
| Sunday 6:00 PM | Strategist Sunday Avoidance Report fires (per `docs/STRATEGIST_SUNDAY_AVOIDANCE_REPORT.md`). |

Total daily Justin time: 20-30 minutes for the entire cold pipeline.

---

## 11. Cost summary at Phase 1 volume

50 prospects sourced per week, ~50/wk reaching Approved → Analysis → Drafted → Sent:

| Component | Per week | Per month |
|---|---|---|
| Google Places API (Pro field mask, ~$0.005/place + ~$0.032/text search) | ~$0.40 | ~$1.60 |
| ScreenshotOne | 50 credits | $17 (after free tier) |
| Claude Haiku 4.5 vision | ~$0.30 | ~$1.30 |
| Hermes 3 405B text (outreach drafts) | ~$0.50 | ~$2.15 |
| Airtable writes (free tier covers easily) | free | free |
| Cloudflare Worker requests (free tier) | free | free |
| Make.com ops (4 scenarios) | ~400 ops | ~1,600 ops (Core plan ceiling 10K) |
| **Total** | **~$1.20** | **~$22** |

At $497 per audit and 2% close from outreach: 50 outreaches/wk × 2% = 1 paid audit/wk = $1,988/mo. The full stack runs at ~1.1% of revenue.

---

## 12. What is intentionally not built

These are deliberately out of scope for Phase 1:

- **Auto-enrichment of email addresses.** Outreach via Instantly assumes the prospect's website has a discoverable contact email or you use Instantly's built-in email finder. If you need automated email finding, wire Hunter.io or Apollo later.
- **Auto-scoring of `fit_score`.** Set manually at the approval gate. Could be auto-suggested by a separate LLM call later; not worth building until you have 50+ manually-scored prospects as training signal.
- **Auto-detection of `budget_signal` / `urgency_signal`.** Same reasoning. Manual at first.
- **Multi-vertical concurrent sourcing.** One vertical, one metro at a time. Add a second only after the first vertical has produced 5 paying audits.
- **Re-sourcing of `killed` prospects.** Once killed, stays killed. To resurface, set `approval_status = "on_hold"` and revisit in 30 days.

---

## 13. Failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| Google API quota exceeded | The $200/mo credit covers ~10k Pro lookups. Phase 1 uses ~50/week (~200/mo). Quota is not the constraint. Monitor in Google Cloud Console → Billing. |
| Duplicate prospect leaked through dedup | Possible if Google returns a place with a different `place_id` than your stored one AND a different website. Manual kill at Gate 1 catches it. |
| Closed business included anyway | The endpoint filters `CLOSED_*` businesses. If Google's status data is stale, manual kill at Gate 1 catches it. |
| Auto-analysis fails after approval | Scenario B's HTTP module logs the error. Prospect sits in "Approved Awaiting Analysis" view. Investigate and manually re-trigger. |
| Outreach drafted but never reviewed | Queue red threshold and Pushover notification flag overdue items. Sunday Avoidance Report names the avoidance. |

---

## 14. Quick start (do this once)

1. **Enable Google Places API (New)** in https://console.cloud.google.com (one-time).
2. **Create an API key** restricted to the Places API (New).
3. **Set the secret:**
   ```powershell
   cd C:\Users\Justin\Documents\hermes-agent-os\worker
   wrangler secret put GOOGLE_PLACES_API_KEY
   ```
4. **Add the Airtable schema fields** listed in Section 3 to your Prospects table.
5. **Create the three Airtable views** from Section 3.
6. **Redeploy the Worker:**
   ```powershell
   wrangler deploy
   ```
7. **Smoke test:**
   ```powershell
   curl -X POST https://hermes-agent-runtime.<sub>.workers.dev/source-prospects `
     -H "Content-Type: application/json" `
     -H "X-Hermes-Secret: <SECRET>" `
     -d '{"vertical":"med spa","metro":"Tampa, FL","max_results":5}'
   ```
   Verify 5 rows appear in Airtable Discovery Pending.
8. **Build Make.com Scenarios A, B, C** per Section 7.
9. **Run Scout once manually for 50 prospects.**
10. **Review and approve in Discovery Pending.** Watch Make.com fire the analysis and drafting automatically.

After step 10, you have a working pipeline. Total setup time: 90-120 minutes once Airtable schema is updated.
