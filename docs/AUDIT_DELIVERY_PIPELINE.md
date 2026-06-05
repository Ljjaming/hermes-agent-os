# Audit Delivery Pipeline

End-to-end flow from "client paid" to "PDF in client's inbox," fully automated except for your 45-minute review.

```
Stripe payment
     ↓
Tally intake submitted
     ↓
Fathom call transcript ready (manual paste for now)
     ↓
[Worker] /distill-transcript  →  structured insight JSON
     ↓
[Worker] /draft-audit          →  70% draft text + ApprovalQueue item
     ↓
You review in Hermes Agent OS Queue (45 min)
     ↓
You approve
     ↓
[Worker] /render-audit         →  branded HTML deliverable
     ↓
[Make.com] HTML to PDF via PDFShift (or Cloudflare Browser Rendering)
     ↓
[Make.com] Upload PDF to Google Drive folder
     ↓
[Make.com] Email Drive link to client with Loom URL
     ↓
[Airtable] Audits.audit_status = delivered, Audits.one_pager_url = Drive link
```

Justin's manual time per audit, end-to-end: ~50 minutes (45 min review + 5 min Loom recording).

---

## Make.com scenario: "Audit Delivery"

Trigger when an `Audits` row in Airtable flips `audit_status` to `approved_for_delivery` (you flip this from `in_review` once you've reviewed in the Queue).

### Modules

1. **Airtable: Watch Records (trigger)**
   - Base: Revenue Leak Pipeline
   - Table: Audits
   - Trigger field: `audit_status`
   - Filter: `{audit_status}='approved_for_delivery'`

2. **HTTP: Make a Request** — render the HTML
   - URL: `https://hermes-agent-runtime.<your-subdomain>.workers.dev/render-audit`
   - Method: POST
   - Headers: `Content-Type: application/json`, `X-Hermes-Secret: <secret>`
   - Body (JSON):
     ```json
     {
       "client_name": "{{1.fields.client_name}}",
       "audit_text": "{{1.fields.draft_content}}",
       "date": "{{formatDate(now; 'YYYY-MM-DD')}}",
       "format": "html"
     }
     ```
   - Response handling: Parse response (Text)

3. **HTTP: Make a Request** — convert HTML to PDF via PDFShift
   - URL: `https://api.pdfshift.io/v3/convert/pdf`
   - Method: POST
   - Headers: `Authorization: Basic <base64(api:YOUR_PDFSHIFT_KEY)>`, `Content-Type: application/json`
   - Body (JSON):
     ```json
     {
       "source": "{{2.data}}",
       "format": "A4",
       "margin": "0.5in",
       "use_print": true,
       "wait_for": "load"
     }
     ```
   - Response handling: Parse response → Binary (PDF bytes)

   **PDFShift free tier:** 50 credits/month, which covers ~50 audits. Pay-as-you-go beyond that, $9 for 250 credits.

   **Alternative (no third-party signup):** Cloudflare Browser Rendering. Requires Workers Paid plan ($5/mo) but renders inside your existing Cloudflare account.

4. **Google Drive: Upload a File**
   - Connection: your Google Drive (one-time OAuth in Make.com)
   - Drive: My Drive (or a Team Drive)
   - Folder: pick a fixed folder (e.g., `Revenue Leak Audits / Delivered`)
   - File name: `{{1.fields.client_name}} — Revenue Leak Audit {{formatDate(now; 'YYYY-MM-DD')}}.pdf`
   - File content: `{{3.data}}` (binary from module 3)
   - MIME type: `application/pdf`

5. **Airtable: Update a Record**
   - Table: Audits
   - Record ID: `{{1.id}}`
   - Fields:
     - one_pager_url: `{{4.webViewLink}}` (Google Drive shareable URL)
     - audit_status: `delivered`
     - delivered_at: `{{now}}`

6. **Email: Send an Email** (Gmail module)
   - To: pulled from Prospect linked record (you'll need an extra Airtable Get module before this if you don't have the email handy)
   - Subject: `Your Revenue Leak Audit — {{1.fields.client_name}}`
   - Body:
     ```
     Hi [first name],

     Your Revenue Leak Audit is ready.

     PDF: {{4.webViewLink}}
     Loom walkthrough: [your-loom-url-here]

     Total time start to finish: 45 minutes. Top of the deliverable
     names the biggest leak, the dollar estimate, and the single thing
     to do tomorrow.

     Refund policy is on page 1 if you need it.

     Replies hit my inbox directly. Tell me what you do with this.

     - Justin
     ```

   Note: You'll need to manually paste the Loom URL in the body when you record it. Or, more cleanly, add a `loom_url` field to the Audits table, fill it from the Queue when you approve, and template `{{1.fields.loom_url}}` here.

7. **Optional: Pushover notification to yourself**
   - "Delivered: {{1.fields.client_name}} audit"
   - One-line confirmation that the pipeline ran end-to-end.

---

## Setting up PDFShift

1. Sign up at https://pdfshift.io (free, 50 credits/mo).
2. Dashboard → API → copy your API key.
3. In Make.com → Connections → Add new → HTTP (or just store the key as a Data Store record).
4. Use the key in module 3 above. Format: `Authorization: Basic <base64(api:YOUR_KEY)>` — the literal string `api` is the username.

## Setting up Google Drive in Make.com

1. Make.com → Connections → Add new → Google Drive.
2. Authorize. Pick the Google account that owns the Drive folder you want.
3. Choose a target folder (Make.com will browse).
4. Done. Module 4 above uses this connection.

---

## Alternative if you want zero third-party signups

Use Cloudflare Browser Rendering instead of PDFShift. Requires Workers Paid ($5/mo).

1. Enable Browser Rendering: `wrangler dispatch-namespace` → not relevant. For Browser Rendering, you bind a Browser Worker.
2. Add binding in `wrangler.toml`:
   ```toml
   [[browser]]
   binding = "MYBROWSER"
   ```
3. Add a new endpoint to the Worker `POST /render-audit-pdf` that uses `env.MYBROWSER.launch()` to spin up a headless Chrome, navigate to the rendered HTML, call `page.pdf()`, return bytes.
4. Make.com module 3 becomes a single POST to your Worker instead of to PDFShift.

This keeps everything in Cloudflare and removes the PDFShift dependency, at a cost of $5/mo + slightly more Worker code. Worth doing once you've delivered 50+ audits and want one less SaaS.

---

## Manual fallback (if Make.com is down or you want to ship one without automation)

1. Hit `/render-audit` directly via curl or Postman with `format: "html"`.
2. Save the HTML response to a file.
3. Open in Chrome.
4. Cmd+P / Ctrl+P → Save as PDF.
5. Upload to Google Drive.
6. Email the client the Drive link.

Takes about 4 minutes manually. Use this as the backup while you're building Make.com.
