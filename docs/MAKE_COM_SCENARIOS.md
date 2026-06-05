# Make.com Scenarios — Phase 1

Three scenarios wire the pipeline together. Build them in this order; each depends on the prior.

**Before you start:**
- Airtable base built per `AIRTABLE_SCHEMA.md`, Personal Access Token created
- Cloudflare Worker deployed per `worker/README.md`, SHARED_SECRET saved
- Sending infrastructure live (Instantly or Smartlead account, warmed inbox)
- Make.com account on at least the Core plan (free works for testing, but the Approval Send scenario needs an HTTP module which is Core+)

---

## Scenario 1: Morning Snapshot

**What it does:** Every weekday at 9am, queries Airtable for current pipeline stats, sends you an email summary. Implements the daily forcing function.

**Trigger:** `Schedule` (Make.com built-in)

### Modules

1. **Schedule (trigger)**
   - Run on: Days of the week → Mon Tue Wed Thu Fri
   - At time: 09:00
   - Timezone: your local

2. **Airtable: Search Records** — pending approvals
   - Connection: your Airtable PAT connection
   - Base: Revenue Leak Pipeline
   - Table: ApprovalQueue
   - Formula: `({status}='pending')`
   - Limit: 100

3. **Iterator** (on the records from module 2) to count by `age_status`
   - Or use **Array Aggregator** + **Set Variable** to compute counts:
     - Total pending: `length(2.records)`
     - Overdue: `length(filter(2.records; {age_status} = 'overdue'))`
     - Aging: `length(filter(2.records; {age_status} = 'aging'))`
     - Oldest hours: `max(map(2.records; time_pending_hours))`

4. **Airtable: Search Records** — sent this week
   - Table: Prospects
   - Formula: `AND({outreach_sent_at} >= DATEADD(NOW(), -7, 'days'))`

5. **Airtable: Search Records** — paid audits this month
   - Table: Audits
   - Formula: `AND({audit_status}='delivered', {delivered_at} >= DATEADD(NOW(), -30, 'days'))`

6. **Email: Send an Email** (or Gmail module if you prefer)
   - To: your email
   - Subject: `Pipeline snapshot {{formatDate(now; 'YYYY-MM-DD')}}`
   - Body (HTML or text):

```
PIPELINE SNAPSHOT — {{formatDate(now; 'ddd MMM D')}}

Pending approvals: {{total_pending}}
  Overdue (>36h): {{overdue}}
  Aging (12-36h): {{aging}}
  Oldest pending: {{oldest_hours}} hours

Outreach sent (last 7 days): {{length(4.records)}}
Target: 50/week
Avoidance index: {{round((50 - length(4.records)) / 50 * 100)}}%

Audits delivered (last 30 days): {{length(5.records)}}
Revenue this month (est.): ${{length(5.records) * 497}}

Open the Queue: https://ljjaming.github.io/hermes-agent-os/#queue
```

7. **Conditional notification (optional):**
   - If `total_pending > 30` OR `overdue > 5`: send Pushover notification with summary
   - Pushover module → priority high → sound: alien

---

## Scenario 2: Approved Outreach Send

**What it does:** Watches the ApprovalQueue for items where you approved an outreach. Sends the message through your warmed sender. Logs the Conversation. Updates the Prospect to "sent" stage.

**Trigger:** Airtable webhook on ApprovalQueue update

### Modules

1. **Airtable: Watch Records (trigger)**
   - Base: Revenue Leak Pipeline
   - Table: ApprovalQueue
   - Trigger Field: `status`
   - Filter (in Airtable webhook config): `AND({status}='approved', {type}='outreach_send')`
   - Limit: 10 per run

2. **Airtable: Get a Record** — fetch the linked Prospect
   - Base: Revenue Leak Pipeline
   - Table: Prospects
   - Record ID: `{{1.fields.prospect[0]}}`

3. **HTTP: Make a Request** — send via Instantly API (or Smartlead, or whichever sender)

   For Instantly:
   - URL: `https://api.instantly.ai/api/v1/lead/send-email`
   - Method: POST
   - Headers: `Authorization: Bearer <INSTANTLY_API_KEY>`, `Content-Type: application/json`
   - Body (JSON):
     ```json
     {
       "campaign_id": "<your-campaign-id>",
       "lead_email": "{{2.fields.email}}",
       "subject": "Re: {{2.fields.business_name}}",
       "body": "{{1.fields.final_content || 1.fields.draft_content}}",
       "from_email": "you@your-outreach-domain.com"
     }
     ```

   (Adjust to whichever sending platform you use. Smartlead's API is similar. If you use raw Gmail, swap this for a Gmail "Send an Email" module, accepting that deliverability degrades over time.)

4. **Airtable: Create a Record** — log the Conversation
   - Base: Revenue Leak Pipeline
   - Table: Conversations
   - Fields:
     - subject: `Outreach: {{2.fields.business_name}}`
     - prospect: `[{{2.id}}]`
     - direction: `outbound`
     - channel: `email`
     - content: `{{1.fields.final_content || 1.fields.draft_content}}`
     - sent_at: `{{now}}`
     - agent_drafted: `outreach`
     - requires_approval: `false`
     - approved: `true`
     - approved_at: `{{1.fields.decided_at}}`

5. **Airtable: Update a Record** — move Prospect to "sent"
   - Table: Prospects
   - Record ID: `{{2.id}}`
   - Fields:
     - stage: `sent`
     - outreach_sent_at: `{{now}}`

6. **Error handler (right-click module 3 → Add error handler):**
   - On error: update the ApprovalQueue item back to `status=pending` and the Prospect to `stage=outreach_drafted`
   - Send Pushover notification: "Outreach send failed for {{2.fields.business_name}}: {{error}}"

---

## Scenario 3: Inbound Reply Classification

**What it does:** When a reply arrives in your outreach inbox, posts it to the Cloudflare Worker's `/classify-reply` endpoint. The Worker classifies it and creates a review item in ApprovalQueue.

**Trigger:** Gmail (or Instantly webhook, or IMAP)

### Modules

1. **Gmail: Watch Emails (trigger)**
   - Connection: the Gmail account that receives outreach replies (your warmed outreach inbox if using a custom domain)
   - Folder: Inbox
   - Filter: `from:* subject:Re:` plus a label rule if you label outbound copies
   - Limit: 10

2. **Filter: Continue only if reply matches an active prospect**
   - Condition: `{{1.from.address}}` exists in Airtable Prospects
   - If not, route to a "Manual Review" Airtable table and stop

3. **Airtable: Search Records** — find the prospect
   - Table: Prospects
   - Formula: `{email}='{{1.from.address}}'` (assumes you have an `email` field on Prospects; add it if not)
   - Limit: 1

4. **HTTP: Make a Request** — post to Worker
   - URL: `https://hermes-agent-runtime.<your-subdomain>.workers.dev/classify-reply`
   - Method: POST
   - Headers:
     - `Content-Type: application/json`
     - `X-Hermes-Secret: <SHARED_SECRET>`
   - Body (JSON):
     ```json
     {
       "prospect_id": "{{3.id}}",
       "conversation_id": null,
       "reply_content": "{{1.text}}"
     }
     ```

5. **Airtable: Create a Record** — log the Conversation
   - Table: Conversations
   - Fields:
     - subject: `Reply from {{3.fields.business_name}}`
     - prospect: `[{{3.id}}]`
     - direction: `inbound`
     - channel: `email`
     - content: `{{1.text}}`
     - received_at: `{{1.date}}`
     - classification: `{{4.classification}}`

6. **Conditional: if classification is `interested`:**
   - Send Pushover notification: "Hot reply from {{3.fields.business_name}}: {{4.suggested_response_intent}}"

---

## Wiring it together

After all three scenarios are saved and enabled:

1. Manually add a test Prospect to Airtable with `stage = outreach_drafted` and a sample `outreach_draft`.
2. Manually create an ApprovalQueue row for that prospect with `type = outreach_send`, `status = pending`.
3. Open Hermes Agent OS → Queue → see the item.
4. Click Approve.
5. Scenario 2 fires, sends the email (test mode in Instantly first to avoid sending to a real address), logs Conversation, updates Prospect to `sent`.
6. Send yourself a reply from another email to verify Scenario 3 fires and creates a Queue item.

Once verified, turn on the daily snapshot (Scenario 1) and let the pipeline run.

---

## Ops budget

| Scenario | Modules | Ops per run | Runs per day | Daily ops |
|---|---|---|---|---|
| Morning Snapshot | 7 | ~10 | 1 | 10 |
| Approved Outreach | 6 | ~6 | ~10 (Phase 1 target) | 60 |
| Inbound Reply | 6 | ~6 | ~2 (Phase 1) | 12 |

Phase 1 daily total: ~80 ops. Make.com Core plan ceiling is 10,000 ops/month, leaving headroom of 12x at Phase 1 scale.

---

## Troubleshooting

**"Scenario 2 didn't fire when I approved":** Make.com Airtable webhooks poll every 1-15 minutes depending on plan. Check the scenario's history tab. If the webhook didn't pick up your change, manually click "Run once" to test the filter logic.

**"Worker returned 401":** SHARED_SECRET mismatch. Verify the secret in Make.com matches the one set via `wrangler secret put SHARED_SECRET`.

**"Email sent but Conversation not logged":** Check the error handler. Likely the Prospect record ID in module 5 is referencing a stale value. Use `{{2.id}}` (the linked prospect from module 2) rather than `{{1.fields.prospect[0]}}` (the raw linked-record array).

**"Reply classification timing out":** The Worker's LLM call can take 5-10 seconds on the 405B model. Make.com's HTTP module default timeout is 40 seconds, which should be enough. If you hit timeouts, switch to a smaller model (e.g., `nousresearch/hermes-3-llama-3.1-70b`) for the classify-reply endpoint.
