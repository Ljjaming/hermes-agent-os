// Hermes Agent Runtime
// Cloudflare Worker that runs Hermes agents on-demand, triggered by Make.com webhooks.
// Endpoints:
//   GET  /health
//   POST /draft-hook        body: { prospect_id, business_name, website_url, sector, public_notes }
//   POST /draft-outreach    body: { prospect_id, business_name, hook, recipient_first_name }
//   POST /draft-audit       body: { prospect_id, business_name, intake, transcript?, screen_notes? }
//   POST /classify-reply    body: { prospect_id, conversation_id, reply_content }
//
// All requests require header `X-Hermes-Secret: <SHARED_SECRET>`.
// Configure secrets via: wrangler secret put <NAME>
//   LLM_API_KEY
//   AIRTABLE_TOKEN
//   SHARED_SECRET

const VOICE_RULES = `
HARD VOICE CONSTRAINTS:
- Never use em dashes. Use commas, parentheses, periods, or colons.
- Never use emojis unless explicitly instructed.
- Never use consultant-speak (synergies, transformation, leverage, unlock value).
- Never use AI-hype language (revolutionary, next-generation, AI-powered).
- Never flatter, hedge, or pad. If something is weak, name it.
- Specificity beats sophistication. Defensible numbers over confident generalities.
- Prose over bullets when prose carries the meaning.
`;

// Agent prompts duplicate the ones in js/agents.js. Keep both in sync when changing.
const AGENT_PROMPTS = {
  diagnostician: `You are the Diagnostician. Produce ONE SENTENCE: the most specific, defensible observation about the prospect's business that Justin can lead a cold outreach with. Lead with a verifiable signal. Name consequence in dollar or rate terms when defensible. If you cannot defensibly name a leak, return "INSUFFICIENT SIGNAL: [what observation would unblock]." No preamble, no flattery, no hedging.\n${VOICE_RULES}`,

  outreach: `You are the Outreach agent. Draft a cold outreach message that names a specific observed leak in the recipient's business and offers the Revenue Leak Audit as the move. Rules: lead with the specific observation (not flattery), reference a real signal the recipient can verify, one offer + one CTA, under 90 words, sign off in Justin's voice. Affiliate disclosure not required for audit outreach. End with: "If you want me to take a closer look, the Revenue Leak Audit is $497 and ships in 7 days. ljjaming.github.io/revenue-leak-audit"\n${VOICE_RULES}`,

  auditor: `You are the Auditor. Produce a 70% complete draft of the Revenue Leak Audit deliverable from the inputs you receive. Use the standard structure: Five-Gap Scorecard, Biggest Operational Leak, Dollar Estimate (with math shown), Diagnosis (one paragraph), 30-Day Action Plan (Week 1, Week 2, Week 3-4 with owner/tool/verification), Recommended Automations (trigger-condition-action, max 5, ranked), Next Move (one sentence). Mark guesses with [REVIEW]. Mark missing-data sections with "INSUFFICIENT DATA: [what would unblock]." Show your math on dollar estimates. Do not produce generic recommendations. Do not pad.\n${VOICE_RULES}`,

  inbox: `You classify inbound replies into exactly one of: interested, objection, deferral, refusal, ghost. Output JSON: {"classification": "<category>", "confidence": "<low|medium|high>", "reasoning": "<one sentence>", "suggested_response_intent": "<one sentence on what kind of reply makes sense, NOT the reply itself>"}. Be skeptical of soft-positive language that lacks a concrete next step.\n${VOICE_RULES}`,

  screenshot_analyzer: `You are the Screenshot Analyzer. You receive a screenshot of a business website and return STRUCTURED JSON identifying visible revenue leaks. Your output feeds outreach drafting and the paid Revenue Leak Audit.

YOU FOCUS ON visible conversion leaks, not generic design criticism. The buyer is a small business owner. Output must be actionable, defensible from what you actually see, and useful for sales outreach.

CATEGORIES (each leak must fit exactly one):
- cta: button copy, placement, count, visual weight
- trust: missing testimonials, badges, case studies, logos, real photos
- mobile: layout broken, tap targets too small, mobile-specific friction
- offer: unclear price, unclear what is being sold, hidden pricing
- booking: scheduling friction, deep booking flow, no calendar visible
- intake: form too long, mandatory fields, no progress indicator
- clarity: confusing headline, unclear hero, missing value prop
- friction: paywall before value, gated content, required signup before benefit
- follow_up: no email capture, no lead magnet, single CTA loses non-buyers
- design: only flag if directly affecting conversion (broken layout, illegible text)

OUTPUT STRICT JSON (no preamble, no markdown fences, no commentary outside the JSON object):

{
  "business_name": "<echo from input or extract from screenshot>",
  "website_url": "<echo from input>",
  "overall_leak_score": 1-5,
  "visual_summary": "<2-sentence description of what is on screen>",
  "visible_leaks": [
    {
      "leak": "<one-line specific leak>",
      "category": "<one of the categories above>",
      "severity": 1-5,
      "evidence": "<what you literally see in the screenshot>",
      "why_it_matters": "<one sentence on revenue impact>",
      "suggested_fix": "<one sentence specific fix>"
    }
  ],
  "best_outreach_angle": "<one sentence on which leak to lead with in cold outreach>",
  "one_sentence_hook": "<a hook ready to drop into cold outreach, anchored to the most visible leak>",
  "loom_talking_points": ["<point 1>", "<point 2>", "<point 3>"],
  "audit_relevance": "<one sentence on what the paid Revenue Leak Audit would surface beyond what is visible>",
  "needs_human_review": true|false
}

SEVERITY SCALE:
- 5: critical visible leak, likely costing 20%+ of conversion
- 4: high visible leak, likely costing 10-20%
- 3: moderate, defensible leak
- 2: minor, worth noting but not a hook
- 1: nitpick, do not include unless you have nothing else

RULES:
- Do not invent facts outside the screenshot. If you cannot confirm something, set needs_human_review true and skip that claim.
- Quote specific visual elements. Example: "button reads 'Get Started'", "form shows 9 fields", "no testimonials in viewport".
- If the screenshot is blank, unparseable, or an error page, return needs_human_review true with empty leaks array.
- visible_leaks: max 5. Rank by severity desc. If fewer than 3 are defensible, return what you have.
- one_sentence_hook must be drop-in-ready for cold outreach. Use Justin's voice.
- audit_relevance should make the buyer want the paid audit (what is NOT visible from outside).

HARD VOICE CONSTRAINTS apply to all free-text fields:
- No em dashes. Use commas, parentheses, periods, colons.
- No emojis.
- No consultant-speak.
- No flattery.
- Specificity beats sophistication.`,

  distiller: `You are the Transcript Distiller. Your only job is to extract five categories of insight from a sales call transcript. You produce STRUCTURED JSON, nothing else. No preamble, no summary, no commentary outside the JSON.

OUTPUT SHAPE (return exactly this structure, all keys required, arrays may be empty):

{
  "objections": [
    { "ts": "<timestamp as found in transcript, or empty string>", "quote": "<verbatim words>", "category": "time|budget|trust|fit|authority|other" }
  ],
  "buying_signals": [
    { "ts": "...", "quote": "<verbatim>", "strength": "low|medium|high" }
  ],
  "commitments": [
    { "by": "operator|user|justin", "ts": "...", "commitment": "<specific action with a verb>" }
  ],
  "self_reported_leaks": [
    { "ts": "...", "leak": "<what the operator named as a leak>", "verifiable_from_call": true }
  ],
  "contradictions": [
    { "ts": "...", "operator_claim": "<what they said>", "evidence_against": "<what was said or implied later that contradicts it>" }
  ]
}

DEFINITIONS:
- Objection: anything that resists the next step. Example: "I'm not sure I have time," "We just rebuilt this last year," "I need to talk to my partner."
- Buying signal: anything that names urgency, pain, or willingness to pay. Example: "If we could fix the booking thing, that's probably worth $5k." Mark "low" if hedged or speculative.
- Commitment: specific action with a verb attached to a person. "I'll send you the Stripe export by Friday." NOT "I'll think about it."
- Self-reported leak: the operator naming where they think they're losing time or revenue. Include even if you doubt it.
- Contradiction: when the operator's stated process and described behavior diverge. Example: claims "we follow up within an hour" then later mentions "most leads ignore the second email a week later."

RULES:
- Output ONLY valid JSON. No markdown code fences. No commentary.
- Quote verbatim, do not paraphrase.
- Use empty string "" for ts when no timestamp present.
- An empty array is the correct answer when nothing in that category exists.
- Skepticism is appropriate. Soft positive ("yeah maybe, sounds interesting") is not a buying signal at strength medium or high.

If the transcript is empty or unparseable, return:
{ "objections": [], "buying_signals": [], "commitments": [], "self_reported_leaks": [], "contradictions": [], "error": "transcript unparseable" }

${VOICE_RULES}`,
};

// ---------- Site Inspector ----------
// Fetches a public URL and extracts: tech stack, CTAs, pricing visibility,
// booking flow depth, trust signals, team page presence. Synthesizes leak
// candidates from the combination. Used as the public_notes input to the
// Diagnostician when no manual notes are provided.

const FINGERPRINTS = {
  Stripe: [/js\.stripe\.com/, /stripe-js/, /pk_(test|live)_/],
  Calendly: [/calendly\.com/i],
  'Cal.com': [/\bcal\.com\/embed/, /\bcal\.com\/(?!embed)/],
  HubSpot: [/js\.hs-(scripts|analytics)/, /hsforms\.com/, /hubspot/i],
  GoHighLevel: [/gohighlevel/i, /leadconnectorhq/i, /msgsndr/i],
  Tally: [/tally\.so\/embed/, /tally\.so\/r\//],
  Mailchimp: [/list-manage\.com/, /mailchimp/i],
  Klaviyo: [/klaviyo\.com/, /kla\.js/],
  ConvertKit: [/convertkit\.com/, /\bck\.com\b/],
  ActiveCampaign: [/activehosted\.com/, /actibox/],
  Webflow: [/webflow\.com/, /\bw-(form|input|button|nav)/, /assets\.website-files\.com/],
  WordPress: [/wp-content/, /wp-includes/, /wp-json/],
  Shopify: [/cdn\.shopify\.com/, /shopify/i],
  Squarespace: [/squarespace\.com/, /static1\.squarespace/],
  Wix: [/parastorage\.com/, /wix\.com/, /wixstatic\.com/],
  Intercom: [/intercom\.io/, /intercomcdn\.com/, /widget\.intercom/],
  Drift: [/drift\.com/, /js\.driftt\.com/],
  Crisp: [/crisp\.chat/, /client\.crisp\.chat/],
  Typeform: [/typeform\.com/, /\btf\.js\b/],
  GoogleAnalytics: [/googletagmanager\.com\/gtag\/js/, /\bga\.js\b/, /google-analytics\.com/],
  Plausible: [/plausible\.io/],
  Fathom: [/cdn\.usefathom\.com/],
  Notion: [/notion\.so/],
  Airtable: [/airtable\.com/],
  Loom: [/\bloom\.com/, /loomcdn\.com/],
  Vimeo: [/\bvimeo\.com/, /player\.vimeo/],
  YouTube: [/youtube\.com/, /youtu\.be/],
};

const CTA_KEYWORDS = /\b(book|schedule|buy|get\s+started|start|try|demo|call|consultation|sign\s*up|join|claim|begin|launch|grab|purchase|order|reserve|apply|see\s+pricing|view\s+plans|free\s+trial)\b/i;

function detectStack(html) {
  const detected = [];
  for (const [tool, patterns] of Object.entries(FINGERPRINTS)) {
    if (patterns.some((p) => p.test(html))) detected.push(tool);
  }
  return detected;
}

function extractCTAs(html) {
  const ctas = [];
  const linkRegex = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  const buttonRegex = /<button\s+([^>]*?)>([\s\S]*?)<\/button>/gi;
  let match;

  const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = match[1];
    const text = stripTags(match[2]);
    if (!text || text.length > 80) continue;
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/.exec(attrs);
    const href = hrefMatch ? hrefMatch[1] : '';
    if (CTA_KEYWORDS.test(text)) ctas.push({ text, href, type: 'link' });
    if (ctas.length > 30) break;
  }
  while ((match = buttonRegex.exec(html)) !== null) {
    const text = stripTags(match[2]);
    if (!text || text.length > 80) continue;
    if (CTA_KEYWORDS.test(text)) ctas.push({ text, href: '', type: 'button' });
    if (ctas.length > 50) break;
  }
  // Dedupe by text+href
  const seen = new Set();
  return ctas.filter((c) => {
    const k = `${c.text}::${c.href}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);
}

function detectPricing(html) {
  const visible = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');

  const priceMatches = visible.match(/\$\s?\d{1,3}(,\d{3})*(\.\d{2})?(\s?\/\s?(month|mo|yr|year|week|wk|user))?/gi);
  if (priceMatches && priceMatches.length > 0) {
    return { state: 'visible_on_page', samples: [...new Set(priceMatches)].slice(0, 5) };
  }

  if (/href\s*=\s*["'][^"']*\/(pricing|plans|cost|rates)/i.test(html)) {
    return { state: 'requires_navigation' };
  }

  if (/contact\s+(us\s+)?for\s+pricing|request\s+a?\s*quote|pricing\s+(upon|on)\s+request/i.test(visible)) {
    return { state: 'hidden_behind_form' };
  }

  return { state: 'not_found' };
}

function detectBookingFlow(html, ctas) {
  if (/calendly\.com\/(?!login)|cal\.com\/embed|hubspot\.com\/meetings|\/scheduling-form/i.test(html)) {
    return { depth: 1, source: 'direct_calendar_embed_or_link' };
  }
  const bookingCTA = ctas.find((c) => /book|schedule|call|demo|consultation/i.test(c.text));
  if (bookingCTA) {
    if (/calendly|cal\.com|hubspot\.com\/meetings|savvycal|zcal/i.test(bookingCTA.href)) {
      return { depth: 1, source: 'cta_to_calendar' };
    }
    if (/\/contact|\/get-started|\/book|\/request|\/inquir/i.test(bookingCTA.href)) {
      return { depth: 2, source: 'cta_to_form_to_calendar' };
    }
    return { depth: 'unknown', source: `cta_to_${bookingCTA.href || 'unknown'}` };
  }
  return { depth: 'unknown', source: 'no_booking_cta_detected' };
}

function detectTrustSignals(html) {
  const signals = [];
  if (/\btestimonial/i.test(html)) signals.push('testimonials_section');
  if (/case\s*stud/i.test(html)) signals.push('case_studies');
  if (/trusted\s*by|as\s*seen\s*(on|in)|featured\s*in/i.test(html)) signals.push('logo_grid_or_press');
  if (/trustpilot|verisign|bbb\.org|norton|mcafee/i.test(html)) signals.push('trust_badges');
  if (/(\d+(\.\d+)?)\s*\/?\s*5\s*stars?|rated\s*\d/i.test(html)) signals.push('ratings_visible');
  if (/\d+[,\d]*\s*(clients|customers|users|members)/i.test(html)) signals.push('customer_count_claim');
  return signals;
}

function detectTeamPage(html) {
  const linkMatch = /href\s*=\s*["']([^"']*\/(team|about|our-team|company|people)[^"']*)["']/i.exec(html);
  if (!linkMatch) return { exists: false };
  return { exists: true, path: linkMatch[1] };
}

function generateLeakCandidates({ stack, ctas, pricing, booking, trust, teamPage }) {
  const leaks = [];

  if (pricing.state === 'hidden_behind_form') {
    leaks.push('Pricing requires contact form, likely tanking cold-traffic conversion by 30 to 50 percent.');
  }
  if (pricing.state === 'not_found') {
    leaks.push('No pricing visible anywhere, cold buyers cannot self-qualify.');
  }
  if (booking.depth === 2) {
    leaks.push(`Booking flow is two steps deep (${booking.source}), losing buyers at each transition.`);
  }
  if (trust.length === 0) {
    leaks.push('No visible trust signals on the home page, high abandonment risk at decision moment.');
  } else if (trust.length === 1) {
    leaks.push(`Only one trust signal visible (${trust[0]}), thin proof layer for a paid offer.`);
  }
  if (stack.includes('Calendly') && !stack.some((t) => ['Stripe', 'PayPal'].includes(t))) {
    leaks.push('Booking tool present without payment processor visible, paid bookings likely processed manually or by invoice (Activation gap).');
  }
  if (stack.length > 10) {
    leaks.push(`${stack.length} tools detected on the site, indicating likely Disconnected Tools and Manual Repetition gaps in the back-end.`);
  }
  if (ctas.length === 0) {
    leaks.push('No clear CTAs detected on page, possible Engagement gap or aggressive single-CTA design.');
  } else if (ctas.length > 8) {
    leaks.push(`${ctas.length} distinct CTAs detected, likely diluting the primary conversion path (Unclear Decisions gap on the visitor side).`);
  }
  if (!stack.some((t) => ['GoogleAnalytics', 'Plausible', 'Fathom'].includes(t))) {
    leaks.push('No analytics fingerprint detected, owner cannot measure stages 2 through 4 of their funnel (Dormant Data gap, foundational).');
  }
  if (teamPage.exists && stack.includes('Calendly') && booking.depth !== 1) {
    leaks.push('Team page exists but booking does not appear to route by person, likely losing referrals to the wrong calendar.');
  }
  return leaks;
}

async function inspectSite(url) {
  let normalizedUrl = url;
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HermesInspector/1.0; +https://ljjaming.github.io/revenue-leak-audit)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
      cf: { cacheTtl: 3600 },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`Site fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const finalUrl = res.url || normalizedUrl;

  const stack = detectStack(html);
  const ctas = extractCTAs(html);
  const pricing = detectPricing(html);
  const booking = detectBookingFlow(html, ctas);
  const trust = detectTrustSignals(html);
  const teamPage = detectTeamPage(html);

  return {
    url: finalUrl,
    fetched_at: new Date().toISOString(),
    html_size_bytes: html.length,
    stack,
    ctas,
    pricing,
    booking,
    trust_signals: trust,
    team_page: teamPage,
    leak_candidates: generateLeakCandidates({ stack, ctas, pricing, booking, trust, teamPage }),
  };
}

function formatInspectionForPrompt(report) {
  const lines = [];
  lines.push(`URL inspected: ${report.url}`);
  lines.push(`Stack detected: ${report.stack.join(', ') || 'none detected'}`);
  lines.push(`CTAs visible (top ${report.ctas.length}): ${report.ctas.map((c) => `"${c.text}"`).join(' | ') || 'none'}`);
  lines.push(`Pricing: ${report.pricing.state}${report.pricing.samples ? ` (e.g., ${report.pricing.samples.join(', ')})` : ''}`);
  lines.push(`Booking flow depth: ${report.booking.depth} (${report.booking.source})`);
  lines.push(`Trust signals: ${report.trust_signals.join(', ') || 'none'}`);
  lines.push(`Team page: ${report.team_page.exists ? `present (${report.team_page.path})` : 'not found'}`);
  lines.push(`Leak candidates from public signal:`);
  for (const l of report.leak_candidates) lines.push(`  - ${l}`);
  return lines.join('\n');
}

// ---------- PDF Audit Renderer ----------
// Renders the Auditor's text output as a branded, print-ready HTML deliverable.
// Returns either the HTML directly (Content-Type: text/html) or wrapped in JSON.
// Downstream pipeline: Make.com fetches this URL, converts to PDF via PDFShift
// (or browser-native print), uploads to Google Drive, returns Drive URL.

const AUDIT_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Revenue Leak Audit — {{CLIENT_NAME}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 0.5in; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: #ffffff;
    color: #1a1620;
    line-height: 1.65;
    margin: 0;
    padding: 56px 72px 40px;
    max-width: 820px;
    margin: 0 auto;
    font-size: 11pt;
  }
  header.cover {
    display: flex;
    align-items: center;
    gap: 20px;
    padding-bottom: 24px;
    margin-bottom: 32px;
    border-bottom: 2px solid #1a1620;
  }
  .logo { width: 52px; height: 52px; flex-shrink: 0; }
  h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 24pt;
    line-height: 1.05;
    letter-spacing: -0.02em;
    margin: 0 0 4px 0;
    background: linear-gradient(120deg, #8b5cf6 0%, #ec4899 50%, #06b6d4 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    font-weight: 700;
  }
  .meta {
    color: #6b6880;
    font-size: 10pt;
    margin: 0;
  }
  pre.audit-body {
    font-family: 'Inter', sans-serif;
    font-size: 10.5pt;
    line-height: 1.7;
    white-space: pre-wrap;
    word-wrap: break-word;
    margin: 0;
    color: #1a1620;
  }
  .section-heading {
    display: block;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 14pt;
    font-weight: 700;
    color: #1a1620;
    margin: 28px 0 10px 0;
    padding-top: 18px;
    padding-bottom: 4px;
    border-top: 1px solid #e6e3ee;
    letter-spacing: -0.01em;
    page-break-after: avoid;
    break-after: avoid;
  }
  .section-heading .num {
    background: linear-gradient(120deg, #8b5cf6 0%, #ec4899 50%, #06b6d4 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    font-weight: 700;
    margin-right: 8px;
  }
  .review-flag {
    display: inline-block;
    background: #fef3c7;
    color: #92400e;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 9pt;
    font-weight: 600;
    margin-right: 4px;
    letter-spacing: 0.04em;
  }
  .insufficient {
    color: #92400e;
    font-weight: 600;
  }
  .refund-block {
    background: #faf9fc;
    border: 1px solid #e6e3ee;
    border-radius: 10px;
    padding: 16px 20px;
    margin: 36px 0 16px 0;
  }
  .refund-block h3 {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12pt;
    margin: 0 0 6px 0;
    color: #1a1620;
  }
  .refund-block p {
    margin: 4px 0;
    font-size: 10pt;
    color: #4a4760;
  }
  footer.audit-footer {
    margin-top: 32px;
    padding-top: 18px;
    border-top: 1px solid #e6e3ee;
    font-size: 9pt;
    color: #6b6880;
    line-height: 1.55;
  }
  footer.audit-footer p { margin: 3px 0; }
  footer.audit-footer a { color: #8b5cf6; text-decoration: none; }
  footer.audit-footer .stamp {
    margin-top: 10px;
    color: #b8b6c4;
    font-size: 8.5pt;
  }
  @media print {
    body { padding: 24px 36px; }
    .section-heading { break-before: auto; break-after: avoid; }
    .refund-block { break-inside: avoid; }
  }
</style>
</head>
<body>
  <header class="cover">
    <svg viewBox="0 0 240 240" class="logo" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="auditLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8b5cf6"/>
          <stop offset="50%" stop-color="#ec4899"/>
          <stop offset="100%" stop-color="#06b6d4"/>
        </linearGradient>
      </defs>
      <polygon points="120,18 224,204 16,204" fill="url(#auditLogoGrad)"/>
      <polygon points="120,72 188,194 52,194" fill="#ffffff"/>
      <polygon points="120,118 162,178 78,178" fill="url(#auditLogoGrad)"/>
    </svg>
    <div>
      <h1>Revenue Leak Audit</h1>
      <p class="meta">{{CLIENT_NAME}} &middot; Prepared by Justin Trent &middot; {{DATE}}</p>
    </div>
  </header>

  <pre class="audit-body">{{AUDIT_BODY_HTML}}</pre>

  <div class="refund-block">
    <h3>Refund policy</h3>
    <p>Any time. For any reason. No questions, no forms. Reply to my email saying "refund please" and I process it the same business day. There is no time limit.</p>
  </div>

  <footer class="audit-footer">
    <p><strong>Justin Trent</strong> &middot; Clarity &amp; Resolution</p>
    <p><a href="mailto:Ljjaming@gmail.com">Ljjaming@gmail.com</a> &middot; <a href="https://ljjaming.github.io/revenue-leak-audit">ljjaming.github.io/revenue-leak-audit</a></p>
    <p class="stamp">Delivered {{DATE}} &middot; Revenue Leak Audit v1</p>
  </footer>
</body>
</html>`;

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatAuditBody(text) {
  let html = escapeHtml(text);
  // Wrap numbered section headers like "1. FIVE-GAP SCORECARD" in styled blocks
  html = html.replace(/^(\d+)\.\s+([A-Z][A-Z0-9\s\-,&]+)$/gm,
    '<span class="section-heading"><span class="num">$1.</span>$2</span>');
  // Highlight [REVIEW] markers
  html = html.replace(/\[REVIEW\]/g, '<span class="review-flag">REVIEW</span>');
  // Highlight INSUFFICIENT DATA lines
  html = html.replace(/(INSUFFICIENT DATA[^\n]*)/g, '<span class="insufficient">$1</span>');
  return html;
}

function renderAuditHtml({ client_name, audit_text, date }) {
  const d = date || new Date().toISOString().slice(0, 10);
  return AUDIT_HTML_TEMPLATE
    .replace(/\{\{CLIENT_NAME\}\}/g, escapeHtml(client_name || 'Client'))
    .replace(/\{\{DATE\}\}/g, escapeHtml(d))
    .replace(/\{\{AUDIT_BODY_HTML\}\}/g, formatAuditBody(audit_text || 'No audit content provided.'));
}

// ---------- LLM client ----------
async function llmChat(env, systemPrompt, userContent) {
  const url = `${env.LLM_ENDPOINT.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

// ---------- Revenue Leak Scout (Google Places sourcing) ----------
// Sources local businesses via Google Places API (New) and writes them to
// Airtable as Discovery rows with approval_status='pending'. NO downstream
// analysis or outreach is triggered. Promotion to approved is a manual
// step Justin performs in Airtable.

const METRO_BIAS = {
  'tampa, fl':                  { lat: 27.9506, lng: -82.4572, radius: 35000 },
  'tampa st petersburg, fl':    { lat: 27.9506, lng: -82.4572, radius: 40000 },
  'tampa st. petersburg, fl':   { lat: 27.9506, lng: -82.4572, radius: 40000 },
  'st petersburg, fl':          { lat: 27.7676, lng: -82.6403, radius: 25000 },
  'scottsdale, az':             { lat: 33.4942, lng: -111.9261, radius: 25000 },
  'austin, tx':                 { lat: 30.2672, lng: -97.7431, radius: 30000 },
  'charlotte, nc':              { lat: 35.2271, lng: -80.8431, radius: 30000 },
  'nashville, tn':              { lat: 36.1627, lng: -86.7816, radius: 30000 },
  'miami, fl':                  { lat: 25.7617, lng: -80.1918, radius: 30000 },
  'orlando, fl':                { lat: 28.5383, lng: -81.3792, radius: 30000 },
};

function getLocationBias(metro) {
  const key = String(metro || '').toLowerCase().replace(/[^a-z0-9, .]/g, '').trim();
  const match = METRO_BIAS[key];
  if (!match) return null;
  return {
    circle: {
      center: { latitude: match.lat, longitude: match.lng },
      radius: match.radius,
    },
  };
}

async function searchGooglePlaces(env, { vertical, metro, maxResults, languageCode }) {
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY required (https://console.cloud.google.com → APIs & Services → Credentials)');

  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.websiteUri',
    'places.internationalPhoneNumber',
    'places.nationalPhoneNumber',
    'places.rating',
    'places.userRatingCount',
    'places.businessStatus',
    'places.primaryType',
    'places.googleMapsUri',
    'nextPageToken',
  ].join(',');

  const url = 'https://places.googleapis.com/v1/places:searchText';
  const locationBias = getLocationBias(metro);
  const textQuery = `${vertical} ${metro}`.trim();

  const all = [];
  let pageToken = null;
  let safety = 0;

  while (all.length < maxResults && safety < 5) {
    safety++;
    const body = {
      textQuery,
      maxResultCount: Math.min(20, maxResults - all.length),
      languageCode: languageCode || 'en',
    };
    if (locationBias) body.locationBias = locationBias;
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Places ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = await res.json();
    if (Array.isArray(json.places)) all.push(...json.places);
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return all.slice(0, maxResults);
}

async function getExistingDedupKeys(env) {
  // Fetch all prospects to dedup against. Returns sets of place_id and website_url.
  const placeIds = new Set();
  const websites = new Set();
  let offset = null;
  let safety = 0;
  const fields = 'fields%5B%5D=place_id&fields%5B%5D=website_url';
  const baseUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Prospects?${fields}&pageSize=100`;

  while (safety < 50) {
    safety++;
    const full = offset ? `${baseUrl}&offset=${encodeURIComponent(offset)}` : baseUrl;
    const res = await fetch(full, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Airtable list failed ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    for (const rec of (json.records || [])) {
      const pid = rec.fields?.place_id;
      const url = rec.fields?.website_url;
      if (pid) placeIds.add(String(pid).trim());
      if (url) websites.add(String(url).trim().toLowerCase().replace(/\/$/, ''));
    }
    if (!json.offset) break;
    offset = json.offset;
  }
  return { placeIds, websites };
}

function placeToProspectFields(place, { vertical, metro }) {
  const name = place.displayName?.text || place.displayName || 'Unknown';
  const websiteUrl = place.websiteUri || '';
  const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
  const fields = {
    business_name: name,
    website_url: websiteUrl,
    sector: vertical,
    discovery_source: `google_places_${metro.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    stage: 'discovery',
    approval_status: 'pending',
    place_id: place.id || '',
    address: place.formattedAddress || '',
    phone,
    rating: typeof place.rating === 'number' ? place.rating : null,
    review_count: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    business_status: place.businessStatus || '',
    google_maps_url: place.googleMapsUri || '',
  };
  // Strip null/empty to avoid Airtable typecast quirks on optional numerics
  for (const k of Object.keys(fields)) {
    if (fields[k] === null || fields[k] === undefined) delete fields[k];
  }
  return fields;
}

async function batchCreateProspects(env, fieldsArray) {
  if (!fieldsArray.length) return [];
  const created = [];
  for (let i = 0; i < fieldsArray.length; i += 10) {
    const batch = fieldsArray.slice(i, i + 10);
    const result = await airtableRequest(env, 'POST', '/Prospects', {
      records: batch.map((fields) => ({ fields })),
      typecast: true,
    });
    if (Array.isArray(result.records)) created.push(...result.records);
  }
  return created;
}

// ---------- Screenshot capture adapter ----------
// Captures a screenshot from a URL. Pluggable provider:
//   - "screenshotone" (default): https://screenshotone.com, 100/mo free tier
//   - "urlbox": https://urlbox.com, similar API, generous free tier
//   - "cloudflare-browser-rendering": TODO, requires Workers Paid + @cloudflare/puppeteer binding
//
// Returns { image_base64, content_type, captured_at, provider, bytes }.
// Does not currently cache to R2/KV. Re-capturing the same URL costs another credit.

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function captureScreenshot(env, { url, fullPage = false, viewportWidth = 1280, viewportHeight = 800, deviceScaleFactor = 1 }) {
  const provider = (env.SCREENSHOT_PROVIDER || 'screenshotone').toLowerCase();

  if (provider === 'screenshotone') {
    return captureScreenshotOne(env, { url, fullPage, viewportWidth, viewportHeight, deviceScaleFactor });
  } else if (provider === 'urlbox') {
    return captureUrlbox(env, { url, fullPage, viewportWidth, viewportHeight });
  } else if (provider === 'cloudflare-browser-rendering' || provider === 'cf-browser') {
    throw new Error('Cloudflare Browser Rendering not yet wired. Requires Workers Paid + @cloudflare/puppeteer binding. See docs/SCREENSHOT_ANALYZER.md for setup.');
  } else {
    throw new Error(`Unknown SCREENSHOT_PROVIDER: ${provider}`);
  }
}

async function captureScreenshotOne(env, { url, fullPage, viewportWidth, viewportHeight, deviceScaleFactor }) {
  const apiKey = env.SCREENSHOT_API_KEY;
  if (!apiKey) throw new Error('SCREENSHOT_API_KEY required for screenshotone provider (sign up at https://screenshotone.com)');

  const params = new URLSearchParams({
    access_key: apiKey,
    url: url,
    format: 'png',
    full_page: String(fullPage),
    viewport_width: String(viewportWidth),
    viewport_height: String(viewportHeight),
    device_scale_factor: String(deviceScaleFactor),
    block_ads: 'true',
    block_cookie_banners: 'true',
    block_trackers: 'true',
    cache: 'true',
    cache_ttl: '86400',
    wait_until: 'networkidle0',
    response_type: 'by_format',
  });

  const res = await fetch(`https://api.screenshotone.com/take?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ScreenshotOne ${res.status}: ${text.slice(0, 300)}`);
  }

  const buffer = await res.arrayBuffer();
  return {
    image_base64: bufferToBase64(buffer),
    content_type: res.headers.get('content-type') || 'image/png',
    captured_at: new Date().toISOString(),
    provider: 'screenshotone',
    bytes: buffer.byteLength,
  };
}

async function captureUrlbox(env, { url, fullPage, viewportWidth, viewportHeight }) {
  const apiKey = env.SCREENSHOT_API_KEY;
  if (!apiKey) throw new Error('SCREENSHOT_API_KEY required for urlbox provider (sign up at https://urlbox.com)');

  const params = new URLSearchParams({
    url,
    format: 'png',
    full_page: String(fullPage),
    width: String(viewportWidth),
    height: String(viewportHeight),
    block_ads: 'true',
    hide_cookie_banners: 'true',
  });

  const res = await fetch(`https://api.urlbox.com/v1/${apiKey}/png?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Urlbox ${res.status}: ${text.slice(0, 300)}`);
  }

  const buffer = await res.arrayBuffer();
  return {
    image_base64: bufferToBase64(buffer),
    content_type: res.headers.get('content-type') || 'image/png',
    captured_at: new Date().toISOString(),
    provider: 'urlbox',
    bytes: buffer.byteLength,
  };
}

// ---------- Vision adapter ----------
// Clean adapter for vision-capable models (OpenAI-compatible chat completions with image_url).
// Defaults to VISION_* env vars, falls back to LLM_* if vision is unset.
// TODO: support multiple providers natively:
//   - OpenRouter (anthropic/claude-haiku-4-5, openai/gpt-4o-mini, etc.) [supported via OpenAI-compatible]
//   - Anthropic direct API (different content shape: type: "image", source: {...})
//   - Cloudflare Workers AI (env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', ...)) [different binding]
async function analyzeImage(env, { imageUrl, imageBase64, prompt, systemPrompt, temperature = 0.3 }) {
  const endpoint = (env.VISION_ENDPOINT || env.LLM_ENDPOINT || '').replace(/\/$/, '');
  const apiKey = env.VISION_API_KEY || env.LLM_API_KEY;
  const model = env.VISION_MODEL || env.LLM_MODEL;

  if (!endpoint) throw new Error('No vision endpoint configured (set VISION_ENDPOINT or LLM_ENDPOINT)');
  if (!apiKey) throw new Error('No vision API key configured (set VISION_API_KEY or LLM_API_KEY)');
  if (!model) throw new Error('No vision model configured (set VISION_MODEL or LLM_MODEL)');
  if (!imageUrl && !imageBase64) throw new Error('Either imageUrl or imageBase64 is required');

  let imagePart;
  if (imageUrl) {
    imagePart = { type: 'image_url', image_url: { url: imageUrl } };
  } else {
    const dataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;
    imagePart = { type: 'image_url', image_url: { url: dataUrl } };
  }

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      imagePart,
    ],
  });

  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, temperature, messages }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vision LLM ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '';
}

// ---------- Airtable client ----------
async function airtableRequest(env, method, path, body) {
  const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Airtable ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const at = {
  updateProspect: (env, id, fields) =>
    airtableRequest(env, 'PATCH', `/Prospects/${id}`, { fields }),
  createApprovalItem: (env, fields) =>
    airtableRequest(env, 'POST', '/ApprovalQueue', { fields }),
  createAudit: (env, fields) =>
    airtableRequest(env, 'POST', '/Audits', { fields }),
  updateConversation: (env, id, fields) =>
    airtableRequest(env, 'PATCH', `/Conversations/${id}`, { fields }),
  getProspect: (env, id) =>
    airtableRequest(env, 'GET', `/Prospects/${id}`),
};

// ---------- Screenshot Analyzer helpers ----------
async function analyzeScreenshotInternal(env, { imageUrl, imageBase64, business_name, website_url }) {
  const userPrompt = `BUSINESS_NAME: ${business_name || 'unknown'}
WEBSITE_URL: ${website_url || 'unknown'}

Analyze the attached screenshot and produce the structured JSON described in your system prompt. Quote what you literally see. Do not invent details outside the image.`;

  const raw = await analyzeImage(env, {
    imageUrl,
    imageBase64,
    prompt: userPrompt,
    systemPrompt: AGENT_PROMPTS.screenshot_analyzer,
  });

  let parsed;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : raw);
  } catch {
    parsed = {
      business_name: business_name || '',
      website_url: website_url || '',
      overall_leak_score: 0,
      visual_summary: '',
      visible_leaks: [],
      best_outreach_angle: '',
      one_sentence_hook: '',
      loom_talking_points: [],
      audit_relevance: '',
      needs_human_review: true,
      error: 'parse_failure',
      raw_preview: raw.slice(0, 300),
    };
  }

  // Echo input values if the model omitted them
  if (!parsed.business_name && business_name) parsed.business_name = business_name;
  if (!parsed.website_url && website_url) parsed.website_url = website_url;

  return parsed;
}

async function writeAnalysisToProspect(env, prospect_id, analysis, headerPrefix) {
  try {
    const lines = [];
    lines.push(`${headerPrefix} ${new Date().toISOString()}]`);
    lines.push(`Overall leak score: ${analysis.overall_leak_score}/5`);
    if (analysis.one_sentence_hook) lines.push(`Hook: ${analysis.one_sentence_hook}`);
    if (analysis.best_outreach_angle) lines.push(`Outreach angle: ${analysis.best_outreach_angle}`);
    if (Array.isArray(analysis.visible_leaks) && analysis.visible_leaks.length) {
      lines.push(`\nVisible leaks (${analysis.visible_leaks.length}):`);
      for (const l of analysis.visible_leaks) {
        lines.push(`  - [${l.category} s${l.severity}] ${l.leak}`);
      }
    }
    lines.push(`\n--- Full analysis ---\n${JSON.stringify(analysis, null, 2)}`);
    await at.updateProspect(env, prospect_id, { notes: lines.join('\n') });
  } catch (e) {
    console.error('Analysis writeback failed', e);
  }
}

// ---------- Routes ----------
const routes = {
  'GET /health': async () => ({ ok: true, runtime: 'hermes-agent-runtime', time: new Date().toISOString() }),

  'POST /source-prospects': async (request, env) => {
    const body = await request.json();
    const { vertical, metro, max_results = 20, language_code = 'en' } = body;

    if (!vertical || typeof vertical !== 'string') throw new Error('vertical is required (string)');
    if (!metro || typeof metro !== 'string') throw new Error('metro is required (string)');
    const cap = Math.min(Math.max(parseInt(max_results, 10) || 20, 1), 60);

    // 1. Query Google Places
    const places = await searchGooglePlaces(env, {
      vertical: vertical.trim(),
      metro: metro.trim(),
      maxResults: cap,
      languageCode: language_code,
    });

    // 2. Build dedup index from existing Airtable rows
    const { placeIds, websites } = await getExistingDedupKeys(env);

    // 3. Filter
    const fresh = [];
    const skipped = [];
    for (const p of places) {
      const pid = String(p.id || '').trim();
      const url = String(p.websiteUri || '').trim().toLowerCase().replace(/\/$/, '');
      if (pid && placeIds.has(pid)) { skipped.push({ name: p.displayName?.text || p.id, reason: 'duplicate_place_id' }); continue; }
      if (url && websites.has(url)) { skipped.push({ name: p.displayName?.text || p.id, reason: 'duplicate_website' }); continue; }
      fresh.push(p);
    }

    // 4. Skip businesses Google flagged as closed
    const operational = fresh.filter((p) => !p.businessStatus || p.businessStatus === 'OPERATIONAL');
    const closedCount = fresh.length - operational.length;

    // 5. Map to Airtable fields and batch-create
    const fieldsArray = operational.map((p) => placeToProspectFields(p, { vertical: vertical.trim(), metro: metro.trim() }));
    const createdRecords = await batchCreateProspects(env, fieldsArray);

    // 6. Strict JSON summary
    return {
      ok: true,
      requested: {
        vertical: vertical.trim(),
        metro: metro.trim(),
        max_results: cap,
      },
      fetched: places.length,
      duplicates_skipped: skipped.length,
      closed_skipped: closedCount,
      created: createdRecords.length,
      approval_required: true,
      next_step: "Review new rows in Airtable Prospects 'Discovery Pending' view. Set approval_status='approved' to trigger analysis. Set approval_status='killed' to archive.",
      prospects: createdRecords.map((r) => ({
        id: r.id,
        business_name: r.fields?.business_name || '',
        website_url: r.fields?.website_url || '',
        place_id: r.fields?.place_id || '',
        address: r.fields?.address || '',
        rating: r.fields?.rating ?? null,
        review_count: r.fields?.review_count ?? null,
      })),
    };
  },

  'POST /inspect-site': async (request) => {
    const { url } = await request.json();
    if (!url) throw new Error('url is required');
    const report = await inspectSite(url);
    return { ok: true, report };
  },

  'POST /draft-hook': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, website_url, sector } = body;
    let { public_notes } = body;
    let inspection_used = false;

    if (website_url && !public_notes) {
      try {
        const report = await inspectSite(website_url);
        public_notes = formatInspectionForPrompt(report);
        inspection_used = true;
      } catch (e) {
        public_notes = `Site inspection failed: ${e.message}. Drafting hook from name + sector only.`;
      }
    }

    const userContent = `BUSINESS_NAME: ${business_name || 'unknown'}
WEBSITE_URL: ${website_url || 'unknown'}
SECTOR: ${sector || 'unknown'}
PUBLIC_NOTES:
${public_notes || 'none provided'}`;
    const hook = await llmChat(env, AGENT_PROMPTS.diagnostician, userContent);

    if (prospect_id) {
      await at.updateProspect(env, prospect_id, {
        hook,
        stage: 'hook',
        assigned_agent: 'diagnostician',
      });
    }
    return { ok: true, hook, inspection_used };
  },

  'POST /screenshot-capture': async (request, env) => {
    const body = await request.json();
    const { url, full_page, viewport_width, viewport_height, device_scale_factor } = body;
    if (!url) throw new Error('url is required');

    const capture = await captureScreenshot(env, {
      url,
      fullPage: full_page === true,
      viewportWidth: viewport_width || 1280,
      viewportHeight: viewport_height || 800,
      deviceScaleFactor: device_scale_factor || 1,
    });

    return { ok: true, ...capture };
  },

  'POST /analyze-screenshot': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, website_url, screenshot_url, image_base64, writeback } = body;

    if (!screenshot_url && !image_base64) {
      throw new Error('screenshot_url or image_base64 is required');
    }

    const analysis = await analyzeScreenshotInternal(env, {
      imageUrl: screenshot_url,
      imageBase64: image_base64,
      business_name,
      website_url,
    });

    if (prospect_id && writeback && !analysis.error) {
      await writeAnalysisToProspect(env, prospect_id, analysis, '[Screenshot analysis');
    }

    return { ok: true, analysis };
  },

  'POST /analyze-from-url': async (request, env) => {
    const body = await request.json();
    const { url, prospect_id, business_name, writeback, full_page, viewport_width, viewport_height } = body;
    if (!url) throw new Error('url is required');

    // 1. Capture screenshot from the URL
    const capture = await captureScreenshot(env, {
      url,
      fullPage: full_page === true,
      viewportWidth: viewport_width || 1280,
      viewportHeight: viewport_height || 800,
    });

    // 2. Analyze the captured screenshot
    const analysis = await analyzeScreenshotInternal(env, {
      imageBase64: capture.image_base64,
      business_name,
      website_url: url,
    });

    if (prospect_id && writeback && !analysis.error) {
      await writeAnalysisToProspect(env, prospect_id, analysis, `[Auto-analyzed from URL ${url}`);
    }

    return {
      ok: true,
      capture: {
        captured_at: capture.captured_at,
        provider: capture.provider,
        bytes: capture.bytes,
        content_type: capture.content_type,
      },
      analysis,
    };
  },

  'POST /draft-outreach': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, hook, recipient_first_name, screenshot_analysis } = body;

    // Augment hook with screenshot analysis when provided. screenshot_analysis can be
    // the full /analyze-screenshot response (object) or a pre-formatted string.
    let augmentedContext = '';
    if (screenshot_analysis) {
      if (typeof screenshot_analysis === 'string') {
        augmentedContext = `\n\nSCREENSHOT ANALYSIS:\n${screenshot_analysis}`;
      } else {
        const s = screenshot_analysis;
        const leakLines = (s.visible_leaks || [])
          .map((l) => `  - [${l.category} s${l.severity}] ${l.leak} (evidence: ${l.evidence})`)
          .join('\n');
        augmentedContext = `\n\nSCREENSHOT ANALYSIS:\nOverall leak score: ${s.overall_leak_score || 'n/a'}/5\nBest outreach angle: ${s.best_outreach_angle || 'n/a'}\nVisible leaks:\n${leakLines || '  (none)'}\nSuggested hook: ${s.one_sentence_hook || 'n/a'}`;
      }
    }

    const userContent = `RECIPIENT: ${recipient_first_name || 'there'}
BUSINESS_NAME: ${business_name}
HOOK (lead with this observation): ${hook || (typeof screenshot_analysis === 'object' && screenshot_analysis?.one_sentence_hook) || ''}${augmentedContext}`;
    const draft = await llmChat(env, AGENT_PROMPTS.outreach, userContent);

    if (prospect_id) {
      await at.updateProspect(env, prospect_id, {
        outreach_draft: draft,
        stage: 'outreach_drafted',
        assigned_agent: 'outreach',
      });
      await at.createApprovalItem(env, {
        title: `Outreach to ${business_name}`,
        type: 'outreach_send',
        prospect: [prospect_id],
        draft_content: draft,
        agent_source: 'outreach',
        status: 'pending',
        priority: 'normal',
      });
    }
    return { ok: true, draft };
  },

  'POST /distill-transcript': async (request, env) => {
    const body = await request.json();
    const { prospect_id, transcript } = body;
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
      throw new Error('transcript is required (min 20 characters)');
    }

    const userContent = `TRANSCRIPT:\n${transcript}`;
    const raw = await llmChat(env, AGENT_PROMPTS.distiller, userContent);

    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : raw);
    } catch {
      parsed = {
        objections: [], buying_signals: [], commitments: [],
        self_reported_leaks: [], contradictions: [],
        error: 'parse_failure', raw_preview: raw.slice(0, 300),
      };
    }

    if (prospect_id && !parsed.error) {
      try {
        const counts = `obj:${parsed.objections?.length || 0} sig:${parsed.buying_signals?.length || 0} com:${parsed.commitments?.length || 0} leak:${parsed.self_reported_leaks?.length || 0} contra:${parsed.contradictions?.length || 0}`;
        await at.updateProspect(env, prospect_id, {
          notes: `[Distilled transcript ${new Date().toISOString()}] ${counts}\n\n${JSON.stringify(parsed, null, 2)}`,
        });
      } catch (e) {
        console.error('Failed to write distilled transcript to Prospect', e);
      }
    }

    return { ok: true, distilled: parsed };
  },

  'POST /draft-audit': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, intake, transcript, distilled_transcript, screen_notes, screenshot_analysis } = body;
    const parts = [`INTAKE:\n${intake || 'none provided'}`];
    if (distilled_transcript) {
      parts.push(`\nTRANSCRIPT (distilled structured form):\n${typeof distilled_transcript === 'string' ? distilled_transcript : JSON.stringify(distilled_transcript, null, 2)}`);
    } else if (transcript) {
      parts.push(`\nTRANSCRIPT (raw):\n${transcript}`);
    }
    if (screen_notes) parts.push(`\nSCREEN_NOTES (operator-provided):\n${screen_notes}`);
    if (screenshot_analysis) {
      parts.push(`\nSCREENSHOT_ANALYSIS (visible leaks from prospect's site):\n${typeof screenshot_analysis === 'string' ? screenshot_analysis : JSON.stringify(screenshot_analysis, null, 2)}`);
    }
    const userContent = parts.join('\n');

    const draft = await llmChat(env, AGENT_PROMPTS.auditor, userContent);

    let auditId = null;
    if (prospect_id) {
      const audit = await at.createAudit(env, {
        client_name: business_name,
        prospect: [prospect_id],
        intake_received_at: new Date().toISOString(),
        draft_generated_at: new Date().toISOString(),
        draft_content: draft,
        audit_status: 'draft_generated',
      });
      auditId = audit.id;
      await at.createApprovalItem(env, {
        title: `Audit deliverable: ${business_name}`,
        type: 'audit_deliverable',
        prospect: [prospect_id],
        related_audit: [auditId],
        draft_content: draft,
        agent_source: 'auditor',
        status: 'pending',
        priority: 'high',
      });
      await at.updateProspect(env, prospect_id, {
        stage: 'in_audit',
        assigned_agent: 'auditor',
      });
    }
    return { ok: true, draft, audit_id: auditId };
  },

  'POST /render-audit': async (request, env) => {
    const body = await request.json();
    const { client_name, audit_text, date, format } = body;
    if (!audit_text) throw new Error('audit_text is required');
    const html = renderAuditHtml({ client_name, audit_text, date });

    if (format === 'html' || format === 'html-response') {
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return { ok: true, html };
  },

  'POST /classify-reply': async (request, env) => {
    const body = await request.json();
    const { prospect_id, conversation_id, reply_content } = body;
    const userContent = `REPLY:\n${reply_content}`;
    const raw = await llmChat(env, AGENT_PROMPTS.inbox, userContent);

    let parsed;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : raw);
    } catch {
      parsed = { classification: 'ghost', confidence: 'low', reasoning: 'parse failure', suggested_response_intent: 'manual review' };
    }

    if (conversation_id) {
      await at.updateConversation(env, conversation_id, {
        classification: parsed.classification,
      });
    }
    if (prospect_id) {
      await at.updateProspect(env, prospect_id, {
        stage: 'responded',
        reply_received_at: new Date().toISOString(),
        reply_classification: parsed.classification,
      });
      await at.createApprovalItem(env, {
        title: `Reply classified as ${parsed.classification}: ${prospect_id}`,
        type: 'reply_classification',
        prospect: [prospect_id],
        related_conversation: conversation_id ? [conversation_id] : undefined,
        draft_content: `Classification: ${parsed.classification}\nConfidence: ${parsed.confidence}\nReasoning: ${parsed.reasoning}\nSuggested next move: ${parsed.suggested_response_intent}\n\n--- Original reply ---\n${reply_content}`,
        agent_source: 'inbox',
        status: 'pending',
        priority: parsed.classification === 'interested' ? 'high' : 'normal',
      });
    }
    return { ok: true, ...parsed };
  },
};

// ---------- Entry ----------
function authenticate(request, env) {
  const got = request.headers.get('X-Hermes-Secret');
  return got && got === env.SHARED_SECRET;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Hermes-Secret',
        },
      });
    }

    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json({ error: 'Not found' }, 404);

    // Health is open
    if (key !== 'GET /health' && !authenticate(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    try {
      const result = await handler(request, env);
      // Allow handlers to return Response objects directly (e.g., HTML)
      if (result instanceof Response) return result;
      return json(result);
    } catch (e) {
      console.error('Handler error', e);
      return json({ error: e.message || String(e) }, 500);
    }
  },
};
