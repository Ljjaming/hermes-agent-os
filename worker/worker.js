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

  'POST /draft-hook': async (request, env) => {
    const body = await request.json();
    const { prospect_id, business_name, website_url, sector, public_notes } = body;
    const userContent = `BUSINESS_NAME: ${business_name || 'unknown'}
WEBSITE_URL: ${website_url || 'unknown'}
SECTOR: ${sector || 'unknown'}
PUBLIC_NOTES: ${public_notes || 'none provided'}`;
    const hook = await llmChat(env, AGENT_PROMPTS.diagnostician, userContent);
    if (prospect_id) {
      await at.updateProspect(env, prospect_id, {
        hook,
        stage: 'hook',
        assigned_agent: 'diagnostician',
      });
    }
    return { ok: true, hook };
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
