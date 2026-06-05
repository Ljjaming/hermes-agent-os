# Screenshot Analyzer

Vision-based skill that turns a screenshot of a prospect's website into a structured list of visible revenue leaks. Used to sharpen cold outreach from "I noticed your site may have leaks" to "I found 3 visible leaks on your homepage. Here's the proof."

Sits between Site Inspector (technical fingerprint) and Transcript Distiller (conversation insight) in the evidence pipeline.

## Three endpoints

| Endpoint | When to use |
|---|---|
| `/screenshot-capture` | You only need the screenshot bytes (e.g., for archival, manual review) |
| `/analyze-screenshot` | You already have a screenshot URL or base64 and want it analyzed |
| `/analyze-from-url` | URL-only input. Captures and analyzes in one call. **The lethal one.** |

## Endpoint: `/screenshot-capture`

Captures a screenshot of a URL via configured provider. Returns base64 PNG.

### Request

```json
{
  "url": "https://acmemed.com",
  "full_page": false,
  "viewport_width": 1280,
  "viewport_height": 800,
  "device_scale_factor": 1
}
```

| Field | Required | Default | Notes |
|---|---|---|---|
| `url` | yes | — | URL to capture |
| `full_page` | no | false | Capture full scrollable page or just viewport |
| `viewport_width` | no | 1280 | Desktop default; use 375 for mobile |
| `viewport_height` | no | 800 | Use 812 for iPhone-style |
| `device_scale_factor` | no | 1 | Use 2 for retina |

### Response

```json
{
  "ok": true,
  "image_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "content_type": "image/png",
  "captured_at": "2026-06-05T12:30:00.000Z",
  "provider": "screenshotone",
  "bytes": 245678
}
```

## Endpoint: `/analyze-from-url`

URL-only input. Captures and analyzes in one call. **Use this for new prospects.**

### Request

```json
{
  "url": "https://acmemed.com",
  "prospect_id": "recXXXXX",
  "business_name": "Acme Med Spa",
  "writeback": true,
  "full_page": false,
  "viewport_width": 1280,
  "viewport_height": 800
}
```

### Response

```json
{
  "ok": true,
  "capture": {
    "captured_at": "2026-06-05T12:30:00.000Z",
    "provider": "screenshotone",
    "bytes": 245678,
    "content_type": "image/png"
  },
  "analysis": { /* same shape as /analyze-screenshot output */ }
}
```

(The base64 image is NOT included in the response to keep payloads small. Use `/screenshot-capture` separately if you need the bytes.)

## Endpoint: `/analyze-screenshot`

Headers: `X-Hermes-Secret: <SHARED_SECRET>`

### Request body

```json
{
  "prospect_id": "recXXXXX",
  "business_name": "Acme Med Spa",
  "website_url": "https://acmemed.com",
  "screenshot_url": "https://example.com/screenshot.png",
  "image_base64": "iVBORw0KGgoAAAA...",
  "writeback": true
}
```

| Field | Required | Notes |
|---|---|---|
| `prospect_id` | no | If provided with `writeback: true`, analysis summary is appended to `Prospects.notes` |
| `business_name` | no | Echoed in output if model omits it |
| `website_url` | no | Echoed in output if model omits it |
| `screenshot_url` | required* | Public URL to the screenshot (PNG or JPG) |
| `image_base64` | required* | Base64-encoded image, with or without `data:image/png;base64,` prefix |
| `writeback` | no | Default false. When true, writes summary to Prospect notes |

*Either `screenshot_url` OR `image_base64` is required. If both are present, `screenshot_url` wins.

### Response

```json
{
  "ok": true,
  "analysis": {
    "business_name": "Acme Med Spa",
    "website_url": "https://acmemed.com",
    "overall_leak_score": 4,
    "visual_summary": "Hero shows brand photo and a single CTA reading 'Learn More'. No pricing visible above the fold. Bottom shows a contact form with 9 fields.",
    "visible_leaks": [
      {
        "leak": "Primary CTA reads 'Learn More' instead of a booking action",
        "category": "cta",
        "severity": 4,
        "evidence": "Hero button text: 'Learn More' (gray background, low contrast against hero photo)",
        "why_it_matters": "Cold visitors need an action verb to convert, 'Learn More' suggests more reading is required, not booking",
        "suggested_fix": "Replace with 'Book a Consultation' or 'See Available Times' linked to a Calendly widget"
      },
      {
        "leak": "No pricing visible anywhere on the page",
        "category": "offer",
        "severity": 4,
        "evidence": "Scrolled the visible portion of the screenshot, no $ amounts or 'starting at' language found",
        "why_it_matters": "Service buyers self-qualify by price, no pricing means cold buyers bounce or fill the contact form just to ask",
        "suggested_fix": "Add a transparent starting-at price near the primary CTA, even if 'consultations from $X'"
      },
      {
        "leak": "Contact form is 9 fields long with no progress indicator",
        "category": "intake",
        "severity": 3,
        "evidence": "Form section shows: name, email, phone, service interest, date preference, time preference, message, how-did-you-hear, marketing-consent checkbox",
        "why_it_matters": "Long inline forms abandon at 40-60% past 5 fields, mobile completion drops further",
        "suggested_fix": "Cut to 3 required fields (name, email, service), move the rest to post-booking confirmation flow"
      }
    ],
    "best_outreach_angle": "Lead with the CTA copy issue, it is the most visible and most fixable in 30 minutes",
    "one_sentence_hook": "Your hero CTA reads 'Learn More' against a low-contrast button, which on a service business almost always tanks cold-traffic booking by 30-50 percent compared to a verb-led action.",
    "loom_talking_points": [
      "CTA copy says 'Learn More', should say 'Book a Consultation'",
      "Zero pricing visible above the fold for a service business",
      "9-field contact form is closer to a barrier than an intake"
    ],
    "audit_relevance": "Visible leaks are the surface. The Revenue Leak Audit maps what happens after the form is submitted: response time, follow-up cadence, intake-to-booking conversion, and whether your CRM is reading any of this.",
    "needs_human_review": false
  }
}
```

## Integration with other endpoints

### `/draft-outreach` accepts `screenshot_analysis`

Pass the entire `analysis` object (or a pre-formatted string) as `screenshot_analysis` and the Outreach agent receives structured visible-leak context.

```json
{
  "prospect_id": "recXXX",
  "business_name": "Acme Med Spa",
  "hook": "(optional, will fall back to analysis.one_sentence_hook)",
  "recipient_first_name": "Sarah",
  "screenshot_analysis": { "...": "full /analyze-screenshot output" }
}
```

If no `hook` is provided, the Outreach agent uses the analysis's `one_sentence_hook`. The drafted message will reference specific visible leaks rather than generic claims.

### `/draft-audit` accepts `screenshot_analysis`

Same shape. The Auditor uses it as a SCREENSHOT_ANALYSIS block alongside intake, transcript, and screen notes. Visible-leak evidence feeds the Five-Gap Scorecard directly.

## Vision provider configuration

Set these in `wrangler.toml` (non-secret) and via `wrangler secret put` (secret):

```toml
[vars]
VISION_ENDPOINT = "https://openrouter.ai/api/v1"
VISION_MODEL = "anthropic/claude-haiku-4-5"
```

```powershell
# Only needed if your vision provider uses a different key than LLM_API_KEY:
wrangler secret put VISION_API_KEY
```

If `VISION_*` vars are unset, the adapter falls back to `LLM_*`. Hermes 3 is text-only, so the fallback will fail. Set `VISION_MODEL` explicitly.

### Recommended providers

| Provider | Model | Cost (rough) | Notes |
|---|---|---|---|
| OpenRouter | `anthropic/claude-haiku-4-5` | $1 per 1M input tokens, $5 per 1M output | Best structured extraction, recommended default |
| OpenRouter | `openai/gpt-4o-mini` | $0.15 per 1M input, $0.60 per 1M output | Cheapest, good quality |
| OpenRouter | `google/gemini-2.0-flash-lite-001` | similar | Fast, accurate |
| Cloudflare Workers AI | `@cf/llava-hf/llava-1.5-7b-hf` | free tier | Lower quality, requires Workers binding (not OpenAI-compatible). Adapter does NOT support this yet, TODO. |

Cost per screenshot analyzed at ~1K input + 1K output tokens with Claude Haiku 4.5: ~$0.006. 100 analyses per month: $0.60.

## Acceptance test commands

Replace `<DOMAIN>` and `<SECRET>` with your values.

```powershell
# 1. Endpoint rejects missing screenshot_url and image_base64
curl -X POST https://<DOMAIN>.workers.dev/analyze-screenshot `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{}'
# Expected: 500 with error "screenshot_url or image_base64 is required"

# 2. Endpoint returns strict JSON with valid input
curl -X POST https://<DOMAIN>.workers.dev/analyze-screenshot `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{
    "business_name": "Example",
    "website_url": "https://example.com",
    "screenshot_url": "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png"
  }'
# Expected: 200 with { ok: true, analysis: { ... } }
# Note: a logo screenshot will produce needs_human_review: true with empty leaks

# 3. /draft-outreach still works without screenshot_analysis
curl -X POST https://<DOMAIN>.workers.dev/draft-outreach `
  -H "Content-Type: application/json" `
  -H "X-Hermes-Secret: <SECRET>" `
  -d '{
    "business_name": "Test",
    "hook": "Your booking page asks for credit card before showing prices, almost certainly tanking cold conversion.",
    "recipient_first_name": "Sam"
  }'
# Expected: 200 with { ok: true, draft: "..." }

# 4. /draft-audit still works without screenshot_analysis
# (no change to existing behavior, screenshot_analysis is purely additive)
```

## Real-world usage flow (URL-only, automated)

After `/analyze-from-url` is wired, the fastest path is:

1. Add a Prospect row in Airtable with `website_url` filled.
2. Make.com triggers on new row.
3. Single HTTP call: `POST /analyze-from-url` with `{url, prospect_id, business_name, writeback: true}`.
4. Make.com forwards the analysis to `POST /draft-outreach` as `screenshot_analysis`.
5. Outreach draft lands in your Queue.

Total human input: just the prospect URL. The pipeline does the rest.

## Make.com scenario: "Auto-outreach from URL"

```
Trigger: new Airtable Prospects row, website_url filled, stage="discovery"
  ↓
HTTP: POST /analyze-from-url {url, prospect_id, business_name, writeback: true}
  ↓
HTTP: POST /draft-outreach {prospect_id, business_name, screenshot_analysis: <analysis from step 2>}
  ↓
(Draft lives in ApprovalQueue. You approve in Hermes Agent OS Queue.)
  ↓
On approval: Make.com sends via Instantly + logs Conversation.
```

Total Make.com modules: 4. Ops per prospect: ~6. At Phase 1 volume (50 prospects/week), ~1,200 ops/month, comfortably under Core plan limit.

## Screenshot capture provider configuration

Set in `wrangler.toml`:

```toml
[vars]
SCREENSHOT_PROVIDER = "screenshotone"
```

Set the API key as a secret:

```powershell
wrangler secret put SCREENSHOT_API_KEY
```

### Supported providers

| Provider | Free tier | Paid | Setup |
|---|---|---|---|
| **screenshotone** (default) | 100/mo | $17/mo for 1,000 | Sign up at screenshotone.com, copy access key |
| **urlbox** | 100/mo | $13/mo for 1,500 | Sign up at urlbox.com, copy API key |
| **cf-browser** | Workers Paid only | $5/mo Workers Paid for ~600/day capacity | TODO, see "Cloudflare Browser Rendering upgrade" below |

### Cloudflare Browser Rendering upgrade (when volume hits ~150/mo)

For higher volume at fixed cost ($5/mo flat), switch to Cloudflare Browser Rendering. Setup:

1. **Upgrade to Workers Paid** ($5/mo) in Cloudflare dashboard
2. **Install puppeteer**: `cd worker && npm install @cloudflare/puppeteer`
3. **Add binding to wrangler.toml**:
   ```toml
   [[browser]]
   binding = "BROWSER"
   ```
4. **Set provider**: `SCREENSHOT_PROVIDER = "cf-browser"`
5. **Implement** the `cf-browser` branch in `captureScreenshot()`:
   ```js
   import puppeteer from "@cloudflare/puppeteer";

   async function captureCloudflareBrowser(env, opts) {
     const browser = await puppeteer.launch(env.BROWSER);
     const page = await browser.newPage();
     await page.setViewport({ width: opts.viewportWidth, height: opts.viewportHeight });
     await page.goto(opts.url, { waitUntil: 'networkidle0', timeout: 20000 });
     const buffer = await page.screenshot({ type: 'png', fullPage: opts.fullPage });
     await browser.close();
     return {
       image_base64: bufferToBase64(buffer.buffer),
       content_type: 'image/png',
       captured_at: new Date().toISOString(),
       provider: 'cf-browser',
       bytes: buffer.byteLength,
     };
   }
   ```
6. **Deploy**: `wrangler deploy`

Worth doing once you're past 80-100 screenshots/month and want one less SaaS.

## Limitations

- A single screenshot captures one viewport. For full-funnel analysis you need separate screenshots of homepage, mobile view, pricing page, booking page, intake form. The agent treats each input independently.
- The model cannot click. Anything behind a CTA, form submission, or login is invisible. The Site Inspector partially compensates by detecting public-source tools.
- Vision models occasionally hallucinate text content. The `needs_human_review` flag should be respected for any analysis you plan to send externally.
- Long captures (>3000px tall) can degrade analysis quality. Crop to viewport or split into multiple analyses.

## TODO

- Anthropic direct API support (different content shape using `type: "image"` and `source` block)
- Cloudflare Workers AI binding for `@cf/llava-hf/llava-1.5-7b-hf` (zero-cost option, requires non-OpenAI-compatible adapter path)
- Multi-screenshot batching for full-funnel coverage in a single request
- Auto-screenshot capture via headless browser when only a URL is provided
