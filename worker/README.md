# Hermes Agent Runtime — Cloudflare Worker

The backend that lets agents run while your browser is closed. Make.com triggers it via HTTPS; it calls the LLM, writes results to Airtable, creates Approval Queue items.

## What it does

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Heartbeat. No auth required. |
| `/inspect-site` | POST | Site Inspector: fetches URL, returns tech stack + CTAs + pricing + booking flow + trust signals + leak candidates. |
| `/draft-hook` | POST | Diagnostician produces a one-sentence Hook for a prospect, writes to `Prospects.hook`. Auto-inspects site if `website_url` given without `public_notes`. |
| `/draft-outreach` | POST | Outreach produces an outreach message, writes to `Prospects.outreach_draft`, creates pending `ApprovalQueue` item. |
| `/distill-transcript` | POST | Transcript Distiller: extracts objections, buying signals, commitments, self-reported leaks, contradictions as structured JSON. |
| `/draft-audit` | POST | Auditor produces full audit deliverable, creates `Audits` row + `ApprovalQueue` item. Accepts `transcript` (raw) or `distilled_transcript` (structured). |
| `/render-audit` | POST | Renders Auditor text output as branded HTML deliverable (light theme, A4-print-optimized). Returns HTML in JSON by default, or raw HTML if `format: "html"` is sent. Pipe through PDFShift or browser print, upload to Google Drive. |
| `/classify-reply` | POST | Inbox classifies inbound reply, updates `Conversations` and `Prospects`, creates `ApprovalQueue` review item. |

All POST endpoints require header `X-Hermes-Secret: <your-shared-secret>`.

## One-time setup

### 1. Install Wrangler CLI

```powershell
npm install -g wrangler
wrangler login
```

(`wrangler login` opens a browser, you authorize Cloudflare access.)

### 2. Configure environment

Open `wrangler.toml` and verify:
- `LLM_ENDPOINT` matches your provider (default: OpenRouter)
- `LLM_MODEL` matches the model you want (default: Hermes 3 Llama 405B via OpenRouter)
- `AIRTABLE_BASE_ID` matches your base ID (default: your existing base)

### 3. Set secrets

From the `worker/` directory:

```powershell
cd C:\Users\Justin\Documents\hermes-agent-os\worker

wrangler secret put LLM_API_KEY
# paste your OpenRouter (or other) API key when prompted

wrangler secret put AIRTABLE_TOKEN
# paste your Airtable Personal Access Token

wrangler secret put SHARED_SECRET
# paste any random long string. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Save this string. Make.com needs it on every webhook call.
```

### 4. Deploy

```powershell
wrangler deploy
```

You'll get a URL like `https://hermes-agent-runtime.<your-subdomain>.workers.dev`. Save it. This is what Make.com posts to.

### 5. Verify

```powershell
curl https://hermes-agent-runtime.<your-subdomain>.workers.dev/health
```

You should see `{"ok":true,"runtime":"hermes-agent-runtime","time":"..."}`.

Test the auth gate (should fail):
```powershell
curl -X POST https://hermes-agent-runtime.<your-subdomain>.workers.dev/draft-hook -H "Content-Type: application/json" -d "{}"
# expected: {"error":"Unauthorized"}
```

Test with the secret (should succeed):
```powershell
curl -X POST https://hermes-agent-runtime.<your-subdomain>.workers.dev/draft-hook `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <your-shared-secret>" `
  -d '{"business_name":"Test Med Spa","website_url":"https://example.com","sector":"Med spa","public_notes":"booking page requires CC before showing prices"}'
```

You should see a JSON response with a `hook` field containing a single sentence.

## Updating later

After editing `worker.js`:

```powershell
cd C:\Users\Justin\Documents\hermes-agent-os\worker
wrangler deploy
```

Deploys in ~5 seconds.

## Logs

```powershell
wrangler tail
```

Streams live logs from the worker. Useful when debugging Make.com calls.

Or in the Cloudflare dashboard: Workers & Pages → hermes-agent-runtime → Logs.

## Cost

Free tier covers 100,000 requests/day. At Phase 1 volume (~30 requests/day) you're at <0.1% of the limit. Free indefinitely at this scale.

## Notes on prompts

The agent prompts inside `worker.js` mirror those in `js/agents.js` (Hermes Agent OS frontend). Keep them in sync when changing. Future work: pull prompts from Airtable's Agents table so they're edited in one place.
