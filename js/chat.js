import { getState, appendMessage, getConversation, clearConversation, setActiveChannel, appendEdge, appendLog } from './store.js';
import { getAgents, getAgent, setAgentStatus, extractMentions } from './agents.js';
import { chatCompletion, APIError } from './api.js';

let abortCtrl = null;
let renderListeners = [];

export function onRender(fn) { renderListeners.push(fn); }
function emitRender() { renderListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

export function getActiveChannelMeta() {
  const id = getState().activeChannel;
  if (id === 'broadcast') return { id: 'broadcast', name: 'Broadcast', sub: 'Messages route to all enabled agents.', kind: 'broadcast' };
  const agent = getAgent(id);
  if (agent) return { id: agent.id, name: agent.name, sub: agent.role || '', kind: 'agent', agent };
  return { id: 'broadcast', name: 'Broadcast', sub: 'Messages route to all enabled agents.', kind: 'broadcast' };
}

export function selectChannel(id) {
  setActiveChannel(id);
  emitRender();
}

export function clearActiveConversation() {
  clearConversation(getState().activeChannel);
  emitRender();
}

function buildHistory(channelId, agentId, newUserText) {
  const agent = getAgent(agentId);
  const conv = getConversation(channelId);
  const messages = [];
  if (agent?.systemPrompt) messages.push({ role: 'system', content: agent.systemPrompt });
  for (const m of conv) {
    if (m.error) continue;
    if (m.from === 'user') messages.push({ role: 'user', content: m.content });
    else if (m.from === agentId) messages.push({ role: 'assistant', content: m.content });
    else messages.push({ role: 'user', content: `[from ${getAgent(m.from)?.name || m.from}] ${m.content}` });
  }
  if (newUserText) messages.push({ role: 'user', content: newUserText });
  return messages;
}

async function callAgent({ agentId, channelId, userText, route = 'direct' }) {
  const agent = getAgent(agentId);
  if (!agent) return;

  setAgentStatus(agentId, 'thinking');
  emitRender();

  const placeholder = appendMessage(channelId, {
    from: agentId,
    to: route === 'broadcast' ? 'broadcast' : 'user',
    content: '',
    timestamp: Date.now(),
    streaming: true,
  });

  appendLog('route', `${route === 'broadcast' ? 'broadcast' : 'user'} → ${agent.name}`);

  try {
    abortCtrl = new AbortController();
    const messages = buildHistory(channelId, agentId, userText);
    let full = '';
    setAgentStatus(agentId, 'speaking');
    emitRender();
    await chatCompletion({
      messages,
      signal: abortCtrl.signal,
      onToken: (token) => {
        full += token;
        placeholder.content = full;
        emitRender();
      },
    });
    placeholder.streaming = false;
    placeholder.content = full;
    setAgentStatus(agentId, 'idle');
    emitRender();

    const mentioned = extractMentions(full);
    for (const targetId of mentioned) {
      if (targetId === agentId) continue;
      appendEdge({ from: agentId, to: targetId, timestamp: Date.now(), message: full.slice(0, 120) });
      appendLog('route', `${agent.name} → @${getAgent(targetId)?.name || targetId}`);
      emitRender();
      await callAgent({ agentId: targetId, channelId, userText: full, route: 'mention' });
    }
  } catch (e) {
    placeholder.streaming = false;
    placeholder.error = true;
    placeholder.content = e instanceof APIError ? `Error: ${e.message}` : `Error: ${e?.message || 'Unknown error'}`;
    setAgentStatus(agentId, 'error');
    appendLog('error', `${agent.name} failed: ${placeholder.content}`);
    emitRender();
  }
}

export async function sendMessage(text) {
  const channelId = getState().activeChannel;
  if (!text.trim()) return;

  appendMessage(channelId, {
    from: 'user',
    to: channelId,
    content: text,
    timestamp: Date.now(),
  });
  appendLog('send', `user → ${channelId === 'broadcast' ? 'broadcast' : (getAgent(channelId)?.name || channelId)}`);
  emitRender();

  if (channelId === 'broadcast') {
    const agents = getAgents().filter((a) => a.enabled !== false);
    const explicitMentions = extractMentions(text);
    const targets = explicitMentions.length ? explicitMentions : agents.map((a) => a.id);
    for (const agentId of targets) {
      appendEdge({ from: 'user', to: agentId, timestamp: Date.now(), message: text.slice(0, 120) });
    }
    emitRender();
    await Promise.all(targets.map((agentId) => callAgent({ agentId, channelId, userText: text, route: 'broadcast' })));
  } else {
    appendEdge({ from: 'user', to: channelId, timestamp: Date.now(), message: text.slice(0, 120) });
    emitRender();
    await callAgent({ agentId: channelId, channelId, userText: text, route: 'direct' });

    const explicitMentions = extractMentions(text).filter((id) => id !== channelId);
    for (const targetId of explicitMentions) {
      appendEdge({ from: 'user', to: targetId, timestamp: Date.now(), message: text.slice(0, 120) });
      await callAgent({ agentId: targetId, channelId, userText: text, route: 'mention' });
    }
  }
}

export function abortInFlight() {
  if (abortCtrl) abortCtrl.abort();
}
