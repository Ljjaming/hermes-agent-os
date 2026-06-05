# Revenue Leak Audit — Deliverable Template

This is the exact output structure the Auditor agent produces. Use it as the template for your Loom walkthrough and the one-pager PDF you ship to the client. The agent generates this in plain text, you copy into Notion / Google Doc / Pages / wherever you ship from.

## The final shipped artifact

Two pieces ship to the client:

1. **One-pager PDF** containing sections 1-7 below, formatted in your brand
2. **Loom recording** (5-8 minutes) walking through the one-pager, voiced by you

The Loom is what they paid for. The PDF is the leave-behind they share internally.

## Template (what the Auditor produces, what you ship)

```
[CLIENT NAME] — Revenue Leak Audit
Prepared by Justin Trent | Clarity & Resolution
Delivered [DATE]

────────────────────────────────────────────────────────

1. FIVE-GAP SCORECARD

  Dormant Data:        X/10  | [one-line evidence]
  Disconnected Tools:  X/10  | [one-line evidence]
  Manual Repetition:   X/10  | [one-line evidence]
  Unclear Decisions:   X/10  | [one-line evidence]
  Revenue Leaks:       X/10  | [one-line evidence]

  Lower score = bigger gap.

────────────────────────────────────────────────────────

2. BIGGEST OPERATIONAL LEAK

[2-3 paragraphs naming the leak, where it lives in their system,
why it ranks above the other four.]

────────────────────────────────────────────────────────

3. DOLLAR ESTIMATE

Assumptions:
  • [Assumption A drawn from intake]
  • [Assumption B drawn from intake]
  • [Assumption C]

Math:
  [Show the calculation, e.g.,
   2,400 inbound leads/mo
   × 35% with no follow-up after touch 1
   × 5% close rate if reached
   × $1,800 ACV
   = $75,600 monthly leak, conservative]

Conservative monthly cost: $X
Likely monthly cost: $Y
Confidence: [low / medium / high] because [reason]

────────────────────────────────────────────────────────

4. DIAGNOSIS

[One paragraph, prose not bullets. What the system is currently doing
that it should not be doing, or failing to do that it should. Anchor
to the client's own words from the intake where possible.]

────────────────────────────────────────────────────────

5. 30-DAY ACTION PLAN

Week 1:
  Action:       [specific action]
  Owner:        [Justin / Operator / Specific tool]
  Tool:         [the tool that does the work]
  Verification: [how we know it worked, visible to Justin]

Week 2:
  Action:       [...]
  Owner:        [...]
  Tool:         [...]
  Verification: [...]

Week 3-4:
  Action:       [...]
  Owner:        [...]
  Tool:         [...]
  Verification: [...]

────────────────────────────────────────────────────────

6. RECOMMENDED AUTOMATIONS

Ranked by leverage. Five maximum.

#1 [Name of automation]
  Trigger:    [the event]
  Condition:  [filters]
  Action:     [the outcome, destination tool named]
  Why first:  [one line, why this ranks above the rest]

#2 ...

#3 ...

────────────────────────────────────────────────────────

7. NEXT MOVE

[One sentence. The single thing the operator does tomorrow morning.]

────────────────────────────────────────────────────────

Questions? Justin Trent | Ljjaming@gmail.com
Revenue Leak Audit | ljjaming.github.io/revenue-leak-audit
```

## Review pass (your 45 minutes)

Open the agent's draft and scan for:

1. **`[REVIEW]` markers**: every line the agent flagged. Verify or rewrite.
2. **Dollar estimate math**: walk through it yourself. The agent will sometimes pick an unrealistic assumption. Fix the assumption, don't fight the math.
3. **Diagnosis paragraph**: this is the voice-carrying part. If it reads like a consultant, rewrite it in your voice.
4. **Action plan specificity**: kill any "consider X" phrasing. Replace with imperative actions. If an action is not verifiable, remove it.
5. **Recommended automations**: cut any that require tools the client doesn't have. The agent should respect the `tools_in_use` list but sometimes drifts.

Target: 45-60 minutes from agent draft to shippable PDF. Then 5-8 minutes to record the Loom.

## When to send back to the agent

If you finish the review and the draft is more than 50% wrong, the inputs were probably weak. Common causes:
- No discovery call transcript was attached
- The screen recording link was missing
- The client's `whats_broken` answer was generic

In that case, do not patch the deliverable. Get the missing input and re-run. The agent's job is to produce 70% from real inputs, not 100% from incomplete ones.

## Voice rules (apply during review pass)

- No em dashes (use commas, parens, periods, colons)
- No emojis
- No consultant-speak (synergies, transformation, leverage, unlock value)
- No AI-hype language (revolutionary, next-gen, AI-powered)
- No flattery, no hedging, no padding
- Defensible numbers over confident generalities
- Prose over bullets when prose carries the meaning
