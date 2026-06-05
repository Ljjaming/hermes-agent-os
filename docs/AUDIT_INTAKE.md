# Revenue Leak Audit — Intake Form

This is the Tally form you send to every paying audit client immediately after Stripe checkout. The Auditor agent expects these fields, in this order, with these labels. Match the field names exactly or update the Auditor system prompt.

## How to build it in Tally

1. Go to tally.so → New Form.
2. Title: **Revenue Leak Audit — Intake**.
3. Add the fields below in order.
4. On submission: redirect to `https://ljjaming.github.io/revenue-leak-audit/#audit` with a thank-you message above the fold.
5. Connect Tally → Airtable via Make.com (Phase 1 scenario 3) so submissions land in the Prospects table.

## Fields

| # | Field Name | Field Type | Required | Notes |
|---|---|---|---|---|
| 1 | `business_name` | Short text | Yes | The legal or trading name |
| 2 | `website_url` | URL | Yes | Primary domain |
| 3 | `monthly_revenue_range` | Dropdown | Yes | Options: Under $10k / $10-25k / $25-50k / $50-100k / $100-250k / $250k+ |
| 4 | `sector` | Short text | Yes | e.g., "Med spa," "B2B SaaS," "Solo coaching" |
| 5 | `team_size` | Dropdown | Yes | Options: Solo / 2-5 / 6-10 / 11-25 / 25+ |
| 6 | `tools_in_use` | Multi-select checkbox | Yes | Options: Stripe, PayPal, GoHighLevel, HubSpot, Pipedrive, Salesforce, Calendly, Cal.com, Fathom, Otter, Tally, Typeform, Make.com, Zapier, n8n, ClickUp, Notion, Airtable, Mailchimp, ConvertKit, ActiveCampaign, Klaviyo, Instantly, Smartlead, Lemlist, Webflow, Wix, WordPress, Shopify, Other |
| 7 | `crm_funnel_screenshot` | File upload | Yes | One screenshot of their CRM stage view |
| 8 | `last_30d_refund_count` | Number | Yes | Best estimate is fine |
| 9 | `inbound_response_time` | Dropdown | Yes | Options: Under 1 hour / 1-4 hours / 4-24 hours / 24-72 hours / Over 3 days / I don't know |
| 10 | `whats_broken` | Long text (single sentence) | Yes | "In one sentence: what's broken?" |
| 11 | `what_have_you_tried` | Long text | Yes | "What have you already tried that didn't fix it?" |
| 12 | `leak_hypothesis` | Long text | No | "Where do you think money is leaking? One sentence is fine." |
| 13 | `screen_recording_url` | URL | No | "Optional: 2-minute screen recording of your CRM, inbox, or Stripe dashboard. Loom link works." |
| 14 | `discovery_call_url` | URL | No | "If we've already had a call, paste the Fathom or Otter link here." |

## What the Auditor does with each field

| Field | Used to populate |
|---|---|
| business_name, sector | Header, voice calibration |
| website_url | Public-source verification of tools claimed |
| monthly_revenue_range | Dollar estimate scaling |
| team_size | Manual Repetition gap scoring (solo operators score harder on repetition by default) |
| tools_in_use | Disconnected Tools gap scoring (count of tools without visible bridges) |
| crm_funnel_screenshot | Unclear Decisions and Dormant Data scoring |
| last_30d_refund_count | Revenue Leaks gap (refund pattern) |
| inbound_response_time | Revenue Leaks gap (response-time leak), Manual Repetition gap |
| whats_broken | The single sentence that anchors the Diagnosis section. Quoted verbatim. |
| what_have_you_tried | Ruled-out moves, prevents stale recommendations |
| leak_hypothesis | Cross-check against your own diagnosis. If you disagree, name the disagreement in Diagnosis. |
| screen_recording_url | Triggers SCREEN_NOTES extraction (manual or future agent) |
| discovery_call_url | Triggers TRANSCRIPT extraction (manual paste in Phase 1) |

## Sending it

Append the Tally URL to the Stripe payment success page (via Stripe Dashboard → Payment Links → your link → Customize → After payment → URL). Customer pays, lands on Tally, fills out the form, intake hits Airtable.

In Phase 1 you can do this manually: copy the intake from Airtable, paste into the Auditor agent in Hermes Agent OS, attach the transcript if you have one, and the Auditor drafts the deliverable.

In Phase 2 the Make.com Audit Trigger scenario automates this: new Airtable row in Prospects with `status = paid` → POST to Agent Runtime → Auditor produces draft → result written back to the Audits table → ApprovalQueue surfaces it in Hermes Agent OS.
