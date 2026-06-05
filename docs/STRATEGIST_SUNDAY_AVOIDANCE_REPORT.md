# Strategist Sunday Avoidance Report

A weekly anti-drift forcing function for the Revenue Leak Audit business. Runs every Sunday evening. Forces a confrontation with the question Justin avoids on his own: **did the week produce market contact, or did it produce sophisticated avoidance?**

This is a document and a prompt. No code, no endpoint, no Worker change. Runnable inside Make.com, ChatGPT, Claude, or Hermes Agent OS by pasting the prompt with the week's numbers.

---

## 1. Purpose

The Revenue Leak Audit business has a single bottleneck right now: **market contact**. Not theory, not framework, not tooling, not copy. Sending real messages to real prospects, getting real replies, having real conversations, asking for real money.

Justin's archived failure pattern (per `project_clarity_resolution`) is over-building, over-theorizing, market-averse drift, and difficulty staying inside one offer. These patterns reliably masquerade as productivity. They feel like work. They produce artifacts. They do not produce revenue.

The Sunday report exists to make those patterns visible at a regular cadence, before they consume an entire month. It does this by comparing actual market-contact volume against a weekly target, scoring the week across seven dimensions, classifying what the week actually was, and prescribing the first moves for Monday.

The report does not motivate. It does not shame. It tells the truth.

---

## 2. When it runs

**Every Sunday at 6:00 PM local time.**

Sunday evening because:
- The week is over, the numbers are stable
- It precedes Monday, when the corrections matter
- It catches drift early enough to fix before the following weekend
- It is far enough from the work that Justin can read the report honestly rather than defensively

Two delivery paths:

**Manual:** Justin opens this doc Sunday at 6, copies the prompt block in Section 5, fills in the week's numbers, pastes into Hermes Agent OS Strategist agent (or ChatGPT/Claude). The report arrives in his inbox or in the Strategist chat.

**Automated (Phase 2):** Make.com scheduled scenario runs Sunday 6 PM, pulls weekly counts from Airtable, calls the Strategist via the Hermes Worker `/draft-hook` style endpoint (passing the prompt as the system message), emails the report.

---

## 3. Inputs required

Justin counts and supplies the following each Sunday. Most can be pulled from Airtable views once the pipeline is wired; until then, manual estimates are acceptable.

| Input | Source | Target |
|---|---|---|
| Leads sourced | Airtable Prospects, stage = discovery created this week | 100 |
| Leads scored | Airtable Prospects, hook field populated this week | 50 |
| Custom outreaches sent | Airtable Conversations, direction = outbound, sent_at this week | 25 |
| Follow-ups sent | Airtable Conversations, direction = outbound, thread > 1 message | 15 |
| Looms or mini-audits produced | Manual count (Loom dashboard) | 5 |
| Sales conversations had | Calendly booked + had + Airtable Prospects stage = booked or paid | 5 |
| Paid audits closed | Stripe payment count this week | 1 |
| Hours spent building / refining | Justin's own honest estimate | low |
| Hours spent selling / contacting | Justin's own honest estimate | high |
| Notable replies received | Free text, 1-3 examples | — |
| Notable wins | Free text, 1-3 lines | — |
| Notable misses or stalls | Free text, 1-3 lines | — |
| Emergency or delivery obligation? | Yes/no + 1 line | — |
| Justin's one-line summary of the week | Free text, 1 sentence | — |

If any of the count fields are unknown, fill in `unknown` rather than estimating high. The report treats `unknown` as zero for scoring purposes. Honest zero is more useful than inflated estimate.

---

## 4. Output format

```
STRATEGIST SUNDAY AVOIDANCE REPORT
Week of [DATE_RANGE]

1. THE NUMBERS
   (table comparing actual vs target across 7 inputs)

2. SCORECARD
   (1-5 scores across 7 categories with one-line rationale each)

3. RED FLAGS
   (any rules tripped, with the specific evidence)

4. THE TRUTH
   (single-sentence classification + one paragraph diagnosis)

5. MONDAY CORRECTION PLAN
   First 90 minutes:
   First 5 prospects:
   First 3 follow-ups:
   First public post:
   What you are not allowed to touch until outreach is done:

6. NEXT-WEEK CONSTRAINT
   (one sentence: the single thing that will make next week's report better)
```

Length: tight. Under 500 words. The report must be readable in two minutes or Justin will not read it.

---

## 5. The full report prompt

Paste this into Hermes Agent OS Strategist agent, ChatGPT, or Claude. Fill in the `[BRACKETED]` fields with the week's numbers and notes.

```
You are the Strategist for Justin Trent's Revenue Leak Audit business.

Your job this turn: produce the weekly Sunday Avoidance Report. You report
the truth. You do not motivate. You do not shame. You do not flatter.

VOICE RULES:
- No em dashes (use commas, parentheses, periods, colons)
- No emojis
- No consultant-speak (synergies, transformation, leverage, unlock value)
- No AI-hype language
- No hedging, no padding
- Direct, sober, specific
- Speak as a strategist who cares about Justin but will not let him lie to himself

BUSINESS CONTEXT:
- Offer: Revenue Leak Audit, $497 one-time
- Internal framework: AIOS
- Stated bottleneck: market contact (not theory, not tooling)
- Core rule: no more refinement unless market contact happened this week

WEEKLY TARGETS:
- 100 leads sourced
- 50 leads scored
- 25 custom outreaches sent
- 15 follow-ups sent
- 5 Looms or screenshot-based mini-audits
- 5 sales conversations had
- 1 paid audit closed

THIS WEEK'S INPUTS:
- Leads sourced: [N]
- Leads scored: [N]
- Outreaches sent: [N]
- Follow-ups sent: [N]
- Looms / mini-audits: [N]
- Sales conversations: [N]
- Paid audits closed: [N]
- Hours building / refining: [N]
- Hours selling / contacting: [N]
- Notable replies received: [text or "none"]
- Notable wins: [text or "none"]
- Notable misses or stalls: [text or "none"]
- Emergency or delivery obligation this week: [yes/no, plus 1 line]
- Justin's one-line summary: [text]

ABSOLUTE RULE:
If fewer than 10 real prospects were contacted this week (sum of new outreaches +
follow-ups), classify the week as Avoidance UNLESS the emergency-or-delivery
flag is yes with a defensible reason. Do not bend this rule. It exists because
no week with under 10 real prospects contacted has ever produced a paying client.

PRODUCE THE REPORT IN THIS EXACT STRUCTURE:

STRATEGIST SUNDAY AVOIDANCE REPORT
Week of [DATE_RANGE]

1. THE NUMBERS
Format as a 3-column table: Metric | Actual | Target.
List all 7 count metrics in the order above.
Show the building-hours vs selling-hours ratio underneath the table.

2. SCORECARD
Score each of the 7 categories 1-5 with one-line rationale.

  Market Contact:       X/5  | (rationale)
  Follow-Up Discipline: X/5  | (rationale)
  Offer Clarity:        X/5  | (rationale, did Justin ask for money clearly)
  Sales Conversations:  X/5  | (rationale)
  Delivery Progress:    X/5  | (rationale)
  Avoidance Risk:       X/5  | (5 = high avoidance, 1 = low avoidance)
  Next-Week Focus:      X/5  | (rationale, does Justin know the single constraint)

Scoring anchors:
  5 = on target or exceeding
  4 = within 80% of target
  3 = within 50% of target
  2 = below 50% of target
  1 = essentially no activity

For Avoidance Risk only, the scale is INVERTED:
  5 = high avoidance, lots of building with little selling
  3 = moderate, mixed
  1 = low avoidance, sales-focused week

3. RED FLAGS
List any rules tripped, with the specific evidence:
  - Fewer than 10 prospects contacted: avoidance unless emergency
  - Zero follow-ups: execution failure
  - Zero asks for money: offer paralysis
  - More than 4 hrs/day on infra in a no-sales week: severe avoidance
  - More content drafts than sent outreach: avoidance via creation
  - Built infrastructure that did not unblock a real sale: avoidance disguised
    as productivity

If no flags tripped, write "None tripped this week."

4. THE TRUTH
Classify the week as exactly one of:
  - Revenue-building (sales motion, real conversations, real money)
  - Infrastructure-building (legitimately blocking work was unblocked)
  - Avoidance disguised as productivity (busy, not selling)
  - Recovery / maintenance (legitimate step back)
  - Mixed but acceptable (real progress alongside some drift)

Follow the classification with ONE paragraph of plain diagnosis. Name the
pattern, not the feeling. If the week was avoidance, say so. If the week was
recovery and Justin earned it, say so. If the week was mixed, name the mix
precisely.

5. MONDAY CORRECTION PLAN
Be specific. Use Justin's tools by name where it helps.

  First 90 minutes:
    [Specific action. Example: "Open Airtable Discovery view. Add 10 new
     prospect URLs from the AIPL community sidebar."]

  First 5 prospects:
    [Specific list pattern. Example: "Run /analyze-from-url on the 5 newest
     Discovery rows. Approve the resulting outreach drafts in the Queue."]

  First 3 follow-ups:
    [Specific list. Example: "Open Awaiting Reply view. Send a one-line
     follow-up to the 3 oldest prospects in that view."]

  First public post:
    [Specific topic tied to a pattern Justin actually saw this week. Example:
     "Post on Instagram: 'Three booking pages I looked at this week all asked
     for credit card before showing prices. Here's why that tanks cold
     conversion.' Use the screenshot pattern from /analyze-from-url runs."]

  What you are not allowed to touch until outreach is done:
    [Name the specific thing. Example: "No Worker code, no Hermes Agent OS
     edits, no landing page tweaks, no new agent prompts. Outreach first.
     Tooling later. If a tool genuinely broke and is blocking outreach,
     log it as a single-line Airtable task to handle Tuesday."]

6. NEXT-WEEK CONSTRAINT
ONE sentence. The single thing that, if it happens, will make next week's
report better than this one.

End of report.
```

---

## 6. Scorecard reference (for Justin to self-check before reading the report)

| Category | What it measures | 5 looks like | 1 looks like |
|---|---|---|---|
| **Market Contact** | New outbound touches with real prospects | 25+ custom outreaches sent | Under 5 touches all week |
| **Follow-Up Discipline** | Re-touching silent prospects | 15+ follow-ups sent, no aging items in Queue over 7 days | Zero follow-ups, prospects from 14+ days ago sitting silent |
| **Offer Clarity** | Did you ask for money clearly | $497 ask in every outreach, Stripe link in every reply, no soft asks | Outreach without a price, soft asks like "let me know if interested" |
| **Sales Conversations** | Actual talking-to-humans count | 5+ booked or had | Zero scheduled, zero held |
| **Delivery Progress** | Paid audits shipped on time | All paid audits delivered within 7 days, zero refund requests | Audits late, clients ghosted, refund requests pending |
| **Avoidance Risk** | Time spent building vs selling (INVERTED scale) | 5 means high avoidance: many tool edits, little outreach. 1 means low avoidance: outreach-focused | High = bad. Low = good. |
| **Next-Week Focus** | Do you know the single constraint going into next week | One clear named constraint with a first-90-min action | "I'll see how it goes" or three competing priorities |

---

## 7. Red flag rules

The report enforces these without exception. Each, when tripped, must appear in the Red Flags section with the evidence.

| # | Rule | Why |
|---|---|---|
| 1 | **Fewer than 10 prospects contacted (outreaches + follow-ups) = Avoidance week** unless emergency-or-delivery flag is yes with a defensible reason | Below 10, no week has ever produced a paying client. This is the universal floor. |
| 2 | **Zero follow-ups sent = Execution failure** | Follow-up converts. Skipping it means treating the funnel as if it ends at first touch. |
| 3 | **Zero asks for money = Offer paralysis** | If no outreach included the $497 ask or a Stripe link, the week was lead-warming, not selling. |
| 4 | **More than 4 hours per day on infrastructure in a no-sales week = Severe avoidance** | The Worker is built. Hermes Agent OS is built. The landing page is built. No infra change is more important than 25 outreaches per week right now. |
| 5 | **More content drafts than sent outreach = Avoidance via creation** | Drafting is easy. Sending is hard. If drafts exceed sends, the work is performative. |
| 6 | **Built infrastructure that did not unblock a real sale = Avoidance disguised as productivity** | Every new agent, prompt, scenario, doc must be tied to a sale that would not have happened otherwise. If you cannot name the sale, it was avoidance. |

---

## 8. Monday correction plan (template)

After the report classifies the week, the Monday plan is binding. No edits, no reordering, no "I'll get to outreach after this one small thing."

| Slot | Time | What |
|---|---|---|
| **First 90 minutes** | 8:30-10:00 AM | Outreach-focused work only. Specifically: queue-clearing if items pending, otherwise new outreach generation via `/analyze-from-url` chain. No tabs except Hermes Agent OS, Airtable, and the inbox. |
| **First 5 prospects** | Inside the 90-min block | Specific 5 prospect URLs from the Discovery view, ranked by signal richness. Run the URL-only pipeline, approve the drafts in Queue, send via Instantly. |
| **First 3 follow-ups** | After first 5 prospects | The 3 oldest items in the Awaiting Reply view. One-line follow-ups, sent the same hour. |
| **First public post** | Before noon | One observation drawn from this week's `/analyze-from-url` runs. Real pattern, specific business signal, posted to Instagram or AIPL community. |
| **Forbidden until above is done** | Whole morning | No Worker edits. No Hermes Agent OS changes. No landing page tweaks. No new agent prompts. No new docs. If something genuinely broke, log it as a one-line Airtable task and address Tuesday morning. |

If the week was classified as **Recovery/maintenance**, the plan softens: 30 minutes of outreach minimum, no other rules.

If the week was classified as **Avoidance disguised as productivity**, the plan hardens: no infrastructure work all week until at least 25 outreaches have shipped.

---

## 9. Example report

Below is what the report looks like when run on a real week. This is illustrative, not historical.

```
STRATEGIST SUNDAY AVOIDANCE REPORT
Week of 2026-06-01 to 2026-06-07

1. THE NUMBERS

  Metric                  | Actual | Target
  ------------------------|--------|--------
  Leads sourced           | 18     | 100
  Leads scored            | 12     | 50
  Outreaches sent         | 4      | 25
  Follow-ups sent         | 1      | 15
  Looms / mini-audits     | 0      | 5
  Sales conversations     | 0      | 5
  Paid audits closed      | 0      | 1

  Building hours: 28
  Selling hours: 3
  Ratio: 9.3:1 (building dominated)

2. SCORECARD

  Market Contact:       1/5  | 4 outreaches against a target of 25, 16% of goal
  Follow-Up Discipline: 1/5  | 1 follow-up, 7+ prospects sitting silent past 7 days
  Offer Clarity:        2/5  | Outreaches included the price but no Stripe link
  Sales Conversations:  1/5  | Zero booked, zero held
  Delivery Progress:    5/5  | No paid clients pending, nothing to ship
  Avoidance Risk:       5/5  | 28 hours on infrastructure, 3 on selling. Severe.
  Next-Week Focus:      2/5  | You named "ship the Calendly skill" rather than "send 25 outreaches"

3. RED FLAGS

  - Rule 1 tripped: 5 total prospects contacted (4 outreach + 1 follow-up) against
    floor of 10. No emergency or delivery obligation cited. Week is Avoidance.
  - Rule 2 tripped: only 1 follow-up sent. Awaiting Reply view shows 8 prospects
    past 7 days with no second touch.
  - Rule 4 tripped: 28 hours on Worker, Hermes Agent OS, and docs. Zero sales.
  - Rule 6 tripped: shipped Screenshot Analyzer + capture endpoint this week.
    Cannot name a sale that would not have happened without them. They were
    needed eventually. They were not needed this week.

4. THE TRUTH

Classification: Avoidance disguised as productivity.

You spent the week building the agent runtime that will eventually run outreach,
while doing almost no outreach. The pattern is consistent with your archived
failure mode: you build the system that will do the work, then treat the
building as the work. The infrastructure you shipped is real and will matter.
None of it mattered this week. The 4 outreaches you sent this week would have
worked exactly the same without any of the building you did. The proof is that
they did not produce a single conversation, regardless of how sharp the
underlying tooling now is. Tooling does not compensate for not sending.

5. MONDAY CORRECTION PLAN

  First 90 minutes:
    8:30-10:00 AM, outreach only. Open Airtable Discovery view. If under 25
    rows, add new URLs from the AIPL community sidebar until you hit 25.

  First 5 prospects:
    Run /analyze-from-url on the 5 newest Discovery rows. Approve the resulting
    outreach drafts in the Queue. Hit send.

  First 3 follow-ups:
    Open Awaiting Reply view, sort by outreach_sent_at asc. The 3 oldest
    prospects get a one-line follow-up: "Following up on this. Worth a look?"
    plus the Stripe link.

  First public post:
    Pick the leak with the highest severity from this week's /analyze-from-url
    runs. Post on Instagram: "I looked at [N] booking pages this week. The
    biggest pattern: [specific leak]. Here is what it costs in lost revenue."
    Tag the post #revenueleakaudit.

  What you are not allowed to touch until outreach is done:
    No Worker code. No Hermes Agent OS edits. No landing page tweaks. No new
    agent prompts. No new docs. No GitHub commits. If a tool genuinely broke
    and is blocking outreach, log it as a single-line Airtable task and
    handle Tuesday at 4 PM. Not before.

6. NEXT-WEEK CONSTRAINT

Ship 25 outreaches by Friday 5 PM. Nothing else matters until that number is on
the board.

End of report.
```

The week shown above is bad, the report names it as bad, the corrective plan is clear, the constraint is one sentence. If next week's report shows 25+ outreaches, follow-ups happening, and a conversation booked, the classification flips to Revenue-building. If next week shows the same pattern again, the corrective plan hardens: no infrastructure work for two weeks.

---

## 10. How to use this document

**Sunday 6:00 PM:**
1. Open this file.
2. Copy the prompt in Section 5.
3. Fill in the bracketed inputs from your Airtable views (or honest estimates if Airtable is not yet wired).
4. Paste into Hermes Agent OS Strategist agent, ChatGPT, or Claude.
5. Read the report.
6. Save the report to `notes/sunday-reports/YYYY-MM-DD.md` for future pattern recognition.

**Monday 8:30 AM:**
1. Open Section 5 of the report (Monday Correction Plan).
2. Do exactly what it says, in the order it says.
3. Do not open Worker code or any tooling until the plan is complete.

**Quarterly:**
1. Read the last 13 weekly reports in sequence.
2. Count Revenue-building weeks vs Avoidance weeks.
3. If Avoidance weeks exceed Revenue-building weeks by more than 2:1 across the quarter, the system has failed and the offer or the operator's relationship to it needs to change. Not the tooling.
