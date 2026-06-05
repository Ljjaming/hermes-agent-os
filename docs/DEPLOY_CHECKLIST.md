# Deploy Verification Checklist

Sequenced runbook from "fresh build" to "Phase 1 fully operational." Work through in order. Each step has a success criterion you can verify before moving on.

Time estimate, end to end: about 4-6 hours of focused work, plus the 2-4 week sender warm-up clock running in parallel.

---

## Phase 0: Accounts (sign up in order)

Skip any you already have. Total cost at Phase 1 volume: about $26/month + $5 one-time + $10/yr.

- [ ] **Cloudflare** (free) — https://dash.cloudflare.com/sign-up
- [ ] **OpenRouter** (pay-as-you-go) — https://openrouter.ai. Add $20 credit to start. Used for both text LLM (Hermes 3) and vision (Claude Haiku 4.5).
- [ ] **Airtable** (free for our volume) — https://airtable.com/signup
- [ ] **ScreenshotOne** ($17/mo when you exceed 100/mo) — https://screenshotone.com
- [ ] **Plausible** ($9/mo, 14-day trial) — https://plausible.io/sites/new
- [ ] **Pushover** ($5 one-time) — https://pushover.net (optional, for phone notifications on stalled queue items)
- [ ] **PDFShift** (50/mo free) — https://pdfshift.io (only needed when you wire automatic PDF delivery; manual fallback works without it)
- [ ] **Instantly** or **Smartlead** ($30-50/mo) — for warmed cold email sending. Start the warm-up clock today, parallel to everything else. 2-4 week clock.
- [ ] **Domain** ($10-15/yr) — pick one (justintrent.co, revenueleakaudit.com, etc.) and point its MX/SPF/DKIM records at your Instantly/Smartlead inbox per their setup wizard.

Already have: Stripe, GitHub, Google (for Drive in Make.com), Make.com.

---

## Phase 1: Airtable base

- [ ] Create new base named **Revenue Leak Pipeline** at airtable.com.
- [ ] Build **Prospects** table per `docs/AIRTABLE_SCHEMA.md` (25 fields, 7 views).
- [ ] Build **ApprovalQueue** table per same doc (14 fields incl `time_pending_hours` and `age_status` formulas, 6 views).
- [ ] (Defer Conversations and Audits tables until Phase 1.5, see schema doc for "Phase 1 minimum.")
- [ ] **Get base ID**: open any table, copy the `appXXXXXXXXXXXX` segment from the URL.
- [ ] **Create Personal Access Token**: airtable.com/create/tokens → name "Hermes Agent OS — Phase 1" → scopes `data.records:read`, `data.records:write`, `schema.bases:read` → access only your Revenue Leak Pipeline base. Copy and store the token in your password manager.

**Success criterion:** you can open Prospects in Airtable, manually add a test row, see it in the "Active Pipeline" view.

---

## Phase 2: Stripe success URL

- [ ] Stripe Dashboard → Payment Links → your **Revenue Leak Audit $497** link → **Edit**.
- [ ] Scroll to **After payment** → select **Don't show confirmation page** → **URL**.
- [ ] Paste: `https://tally.so/r/ZjD` (your intake form).
- [ ] **Save**.

**Success criterion:** make a $0.50 test purchase using a Stripe test card or your own card (refund it from Stripe Dashboard right after). The success page lands on your Tally intake.

---

## Phase 3: Cloudflare Worker

### Install + authenticate

```powershell
npm install -g wrangler
wrangler login
```

(`wrangler login` opens a browser, authorize Cloudflare access.)

### Edit config

Open `C:\Users\Justin\Documents\hermes-agent-os\worker\wrangler.toml`:

- [ ] Verify `AIRTABLE_BASE_ID` matches your base ID from Phase 1.
- [ ] Verify `LLM_ENDPOINT` and `VISION_ENDPOINT` (both default to OpenRouter, fine if you signed up for OpenRouter).
- [ ] Verify `LLM_MODEL` and `VISION_MODEL`. Defaults are `nousresearch/hermes-3-llama-3.1-405b` (text) and `anthropic/claude-haiku-4-5` (vision). Change if you want a different mix.

### Set secrets

```powershell
cd C:\Users\Justin\Documents\hermes-agent-os\worker

wrangler secret put LLM_API_KEY
# paste OpenRouter API key

wrangler secret put AIRTABLE_TOKEN
# paste Airtable PAT from Phase 1

wrangler secret put SHARED_SECRET
# generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# paste the hex string. Save it, Make.com needs it on every webhook call.

wrangler secret put SCREENSHOT_API_KEY
# paste ScreenshotOne access key
```

Optional (skip unless you use a separate vision key):
```powershell
wrangler secret put VISION_API_KEY
```

### Deploy

```powershell
wrangler deploy
```

You should see a URL like `https://hermes-agent-runtime.<your-subdomain>.workers.dev`. Save it. This is your **Worker URL** for every subsequent step.

**Success criterion:** `curl https://hermes-agent-runtime.<your-sub>.workers.dev/health` returns `{"ok":true,...}`.

---

## Phase 4: Endpoint smoke tests

Run these in order. Replace `<WORKER>` with your worker subdomain and `<SECRET>` with your SHARED_SECRET. Order is low-cost → high-cost so you catch config issues before burning LLM credits.

### 4.1 Health (no auth, no LLM)

```powershell
curl https://<WORKER>.workers.dev/health
```
Expected: `{"ok":true,"runtime":"hermes-agent-runtime","time":"..."}`

### 4.2 Auth gate

```powershell
curl -X POST https://<WORKER>.workers.dev/draft-hook -H "Content-Type: application/json" -d "{}"
```
Expected: `{"error":"Unauthorized"}` with HTTP 401. Confirms auth works.

### 4.3 Site Inspector (no LLM cost)

```powershell
curl -X POST https://<WORKER>.workers.dev/inspect-site `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"url":"https://stripe.com"}'
```
Expected: JSON with `stack`, `ctas`, `pricing`, `booking`, `trust_signals`, `leak_candidates`.

### 4.4 Screenshot capture (1 ScreenshotOne credit)

```powershell
curl -X POST https://<WORKER>.workers.dev/screenshot-capture `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"url":"https://stripe.com"}'
```
Expected: JSON with `image_base64` (large), `provider: "screenshotone"`, `bytes`, `captured_at`.

### 4.5 Diagnostician (1 LLM call, auto-inspects)

```powershell
curl -X POST https://<WORKER>.workers.dev/draft-hook `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"business_name":"Test Med Spa","website_url":"https://example.com","sector":"Med spa"}'
```
Expected: JSON with `hook` (single sentence), `inspection_used: true`.

### 4.6 Screenshot Analyzer (1 vision LLM call)

```powershell
curl -X POST https://<WORKER>.workers.dev/analyze-screenshot `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"business_name":"Test","website_url":"https://example.com","screenshot_url":"https://images.unsplash.com/photo-1432888622747-4eb9a8efeb07?w=1280"}'
```
Expected: JSON with `analysis.overall_leak_score`, `analysis.visible_leaks`, `analysis.one_sentence_hook`, etc. (A photo screenshot will produce `needs_human_review: true`. That's correct behavior.)

### 4.7 Analyze from URL chain (1 capture + 1 vision call)

```powershell
curl -X POST https://<WORKER>.workers.dev/analyze-from-url `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"url":"https://stripe.com","business_name":"Stripe (test)"}'
```
Expected: JSON with `capture.provider`, `analysis.visible_leaks`.

### 4.8 Outreach (1 text LLM call)

```powershell
curl -X POST https://<WORKER>.workers.dev/draft-outreach `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"business_name":"Test","hook":"Your booking page asks for credit card before pricing, almost certainly tanking cold conversion.","recipient_first_name":"Sam"}'
```
Expected: JSON with `draft` (the outreach message, under 90 words).

### 4.9 Transcript Distiller (1 LLM call)

Paste a real or sample transcript. For testing, this synthetic chunk works:

```powershell
curl -X POST https://<WORKER>.workers.dev/distill-transcript `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"transcript":"(00:02:15) Justin: So what is the biggest thing slowing you down right now? \n (00:02:22) Sarah: We follow up with every lead within an hour, our process is tight. \n (00:14:08) Sarah: Yeah, most of our cold leads ignore the second email a week later. Maybe two weeks. \n (00:23:04) Sarah: If we could fix the booking thing, that is probably worth 5 grand a month."}'
```
Expected: `distilled.objections`, `distilled.buying_signals` (Sarah's 5k claim), `distilled.contradictions` (1-hr follow-up vs 1-2 week silence). All arrays present.

### 4.10 Auditor draft (1 expensive LLM call)

Use a short test intake:

```powershell
curl -X POST https://<WORKER>.workers.dev/draft-audit `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"business_name":"Test Med Spa","intake":"Monthly revenue: 40k. Tools: GoHighLevel, Calendly, Stripe. Team: 3. Refunds last 30d: 2. Response time: 24-72hrs. What is broken: Lots of leads, low conversion to booked. Tried: changed CTAs, no impact."}'
```
Expected: Multi-section draft with FIVE-GAP SCORECARD, BIGGEST OPERATIONAL LEAK, DOLLAR ESTIMATE, etc. May take 10-30 seconds depending on model.

### 4.11 PDF Renderer (no LLM)

```powershell
curl -X POST https://<WORKER>.workers.dev/render-audit `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"client_name":"Test Med Spa","audit_text":"1. FIVE-GAP SCORECARD\nDormant Data: 4/10 | no transcript analyzed\n\n2. BIGGEST OPERATIONAL LEAK\nResponse time is 24-72 hours.\n\n7. NEXT MOVE\nReply to the oldest lead in your inbox.","format":"html"}'
```
Expected: HTML response (content-type text/html) showing the branded deliverable. Open it in a browser by piping to a file:

```powershell
curl -X POST https://<WORKER>.workers.dev/render-audit `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d "{\"client_name\":\"Test\",\"audit_text\":\"sample\",\"format\":\"html\"}" `
  -o test-audit.html

start test-audit.html
```

### 4.12 Inbox classifier (1 LLM call)

```powershell
curl -X POST https://<WORKER>.workers.dev/classify-reply `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{"reply_content":"Thanks for reaching out. Not a fit right now, we are mid rebrand."}'
```
Expected: `{classification: "deferral", confidence: "...", reasoning: "..."}`.

**Success criterion for Phase 4:** all 12 endpoints return expected shapes without errors.

---

## Phase 5: Hermes Agent OS (browser app)

- [ ] Open https://ljjaming.github.io/hermes-agent-os/
- [ ] Click **Settings** tab.
- [ ] Paste **Endpoint URL** (your OpenRouter base): `https://openrouter.ai/api/v1`
- [ ] Paste **API Key** (OpenRouter key).
- [ ] Paste **Model**: `nousresearch/hermes-3-llama-3.1-405b` (or whatever text model you prefer).
- [ ] Paste **Airtable PAT** and **Airtable Base ID**.
- [ ] Click **Test Connection**. Should show "Connected" green.
- [ ] Click **Save Settings**.
- [ ] Go to **Chat** tab. Click any agent. Send "ping." You should see a response stream.

**Success criterion:** chat works AND the Queue tab loads from Airtable (shows "Queue is clear" if no pending items, or your test items if you added any).

---

## Phase 6: Make.com scenarios

Build in this order. Each scenario depends on the prior infrastructure being live.

### 6.1 Morning Snapshot (start here, low risk)

Per `docs/MAKE_COM_SCENARIOS.md` Scenario 1. Triggers Mon-Fri 9am, emails you Queue + send-rate stats. No client-facing risk.

- [ ] Build modules 1-7 per the doc.
- [ ] Run once manually to test (Make.com → Run once button).
- [ ] Verify you get the email.
- [ ] Activate the schedule.

**Success criterion:** you got an email this morning at 9am.

### 6.2 Auto-outreach from URL (Phase 2 path, but worth wiring early)

Per `docs/SCREENSHOT_ANALYZER.md` "Auto-outreach from URL" scenario.

- [ ] Build 4 modules: Airtable trigger → `/analyze-from-url` → `/draft-outreach` → done (queue item created automatically by /draft-outreach).
- [ ] Add a test Prospect row in Airtable with a website_url filled.
- [ ] Check that the scenario fires.
- [ ] Check Hermes Agent OS Queue for the resulting outreach draft.

**Success criterion:** adding a prospect URL produces a drafted outreach in the Queue within 60 seconds, without you touching anything else.

### 6.3 Approved Outreach Send (medium risk, sends real email)

Per `docs/MAKE_COM_SCENARIOS.md` Scenario 2.

- [ ] Wait until your Instantly/Smartlead warm-up is at least 2 weeks in.
- [ ] Build modules 1-6 per the doc.
- [ ] First test: manually approve a queue item targeting your own email address.
- [ ] Verify the email arrives in your own inbox.
- [ ] Activate.

**Success criterion:** you approved a queue item, an email arrived in the recipient's inbox, the Prospect row flipped to stage=sent.

### 6.4 Inbound Reply Classification

Per `docs/MAKE_COM_SCENARIOS.md` Scenario 3.

- [ ] Build modules 1-6 per the doc.
- [ ] Manually reply to a test outreach you sent yourself.
- [ ] Check the Conversations table for the inbound entry.
- [ ] Check the ApprovalQueue for the classified item.

**Success criterion:** reply arrives, classification appears in Queue with confidence level.

### 6.5 Audit Delivery (Phase 1.5)

Per `docs/AUDIT_DELIVERY_PIPELINE.md`.

- [ ] Sign up for PDFShift (or commit to manual print-to-PDF fallback).
- [ ] Build the 6-7 modules per the delivery pipeline doc.
- [ ] Wait until you have a paid client to test end to end (or use a fake one with a real test address).

**Success criterion:** a paid client's audit goes from `approved_for_delivery` → PDF in Google Drive → email to client → Audits.audit_status=delivered.

---

## Phase 7: Forcing functions (anti-drift)

These prevent the Queue from becoming a graveyard. Build after Phase 6.1 (Morning Snapshot) is running.

- [ ] **Pushover phone notifications**: in Make.com Morning Snapshot, add a conditional module: if pending > 30 OR oldest_hours > 36, send Pushover with "Queue overdue: X items, oldest Y hours." Costs $5 one-time.
- [ ] **Strategist Sunday review**: schedule a second Make.com scenario that runs Sunday 6pm, computes average time-to-approval, weekly send rate vs target, items killed without action, and emails Justin a 5-line report.
- [ ] **Queue badge red threshold**: already implemented in the UI. Verify it turns red when ApprovalQueue has any item with `age_status = overdue` (>36h pending).

---

## Phase 8: Go-live checklist

- [ ] Sender domain warm-up complete (Instantly/Smartlead confirms inbox health).
- [ ] All 12 endpoints smoke-tested green.
- [ ] All 5 Make.com scenarios on.
- [ ] Hermes Agent OS Queue is loading and showing items correctly.
- [ ] Morning snapshot emails arriving Mon-Fri 9am.
- [ ] Pushover notifications tested with a real overdue item.
- [ ] Stripe payment link tested end to end (real card, refunded).
- [ ] At least one real Revenue Leak Audit shipped to a real client.
- [ ] Plausible analytics installed on the marketing site, registering visits.

When all 9 are checked, you are operational. Send 5 sharper outreaches today using `/analyze-from-url` → `/draft-outreach`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Worker /health works but other endpoints return 401 | SHARED_SECRET mismatch | Verify `wrangler secret list` shows SHARED_SECRET. Compare to what Make.com is sending. |
| /draft-hook returns "No endpoint configured" | LLM_ENDPOINT or LLM_API_KEY missing | Check wrangler.toml + `wrangler secret list`. Re-set if needed. |
| /analyze-screenshot returns "Vision LLM 404" | VISION_MODEL not available on your provider | Check OpenRouter dashboard, the model name must match exactly. Try `openai/gpt-4o-mini` as fallback. |
| /screenshot-capture returns "ScreenshotOne 403" | API key invalid or quota hit | Check ScreenshotOne dashboard usage. Re-set SCREENSHOT_API_KEY if needed. |
| Hermes Agent OS Queue shows "Failed to load" | Airtable PAT or Base ID wrong | Re-paste both in Settings. Check token scopes include `data.records:read`. |
| Make.com scenario doesn't fire on Airtable change | Airtable webhook lag (1-15 min) | Make.com → Scenario History to see polling. Click "Run once" to force-poll. |
| Outreach drafts feel generic | Hook is weak or screenshot_analysis not passed | Always run `/analyze-from-url` first, pass full analysis into `/draft-outreach`. |
| Auditor draft has too many [REVIEW] markers | Inputs were thin | Add transcript via `/distill-transcript` + screenshot via `/analyze-from-url` before calling `/draft-audit`. |
| PDF deliverable looks broken when printed | Browser print rendered the dark theme | The renderer uses light theme intentionally. If you see dark, check you used `format: "html"` not `format: "html-response"` and printed from a normal browser tab. |

---

## What to do every Monday morning (after go-live)

1. Open the 9am snapshot email.
2. Open Hermes Agent OS Queue.
3. Approve outreach drafts (10 min).
4. Approve any pending reply classifications (5 min).
5. Approve any audit deliverables ready to ship (45 min review per audit).
6. Add 5-10 new prospect URLs to Airtable (the auto-outreach scenario fires from these).
7. Close all tabs. Check back tomorrow morning.

If you do this Mon-Fri, you produce roughly 25-50 outreach sends per week, see all replies in classification within hours, and ship every paid audit within the 7-day promise without thinking about the funnel between sessions.
