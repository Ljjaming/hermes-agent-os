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

// ---------- Routes ----------
const routes = {
  'GET /health': async () => ({ ok: true, runtime: 'hermes-agent-runtime', time: new Date().toISOString() }),

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

  'POST /draft-outreach': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, hook, recipient_first_name } = body;
    const userContent = `RECIPIENT: ${recipient_first_name || 'there'}
BUSINESS_NAME: ${business_name}
HOOK (lead with this observation): ${hook}`;
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

  'POST /draft-audit': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, intake, transcript, screen_notes } = body;
    const parts = [`INTAKE:\n${intake || 'none provided'}`];
    if (transcript) parts.push(`\nTRANSCRIPT:\n${transcript}`);
    if (screen_notes) parts.push(`\nSCREEN_NOTES:\n${screen_notes}`);
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
      return json(result);
    } catch (e) {
      console.error('Handler error', e);
      return json({ error: e.message || String(e) }, 500);
    }
  },
};
