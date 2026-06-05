import { getState, getConversation, clearLogs } from './store.js';
import { initAgents, getAgents, getAgent, addAgent } from './agents.js';
import { onRender, selectChannel, sendMessage, clearActiveConversation, getActiveChannelMeta } from './chat.js';
import { renderNetwork, resetPulseCounter } from './network.js';
import { wireSettings, renderAgentEditor, loadSettingsToForm, onSettingsChange } from './settings.js';
import { loadQueue, wireQueueUI, startQueuePolling } from './queue.js';

initAgents();

const $ = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function highlightMentions(text) {
  const esc = escapeHtml(text);
  return esc.replace(/@([a-z0-9_-]+)/gi, '<span class="msg-mention">@$1</span>');
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

let currentView = 'chat';

function switchView(view) {
  currentView = view;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'network') renderNetwork();
  if (view === 'logs') renderLogs();
  if (view === 'queue') loadQueue();
  if (view === 'settings') {
    loadSettingsToForm();
    renderAgentEditor();
  }
}

function renderSidebar() {
  const list = $('agentList');
  const channels = $$('.channel-item');
  const state = getState();

  channels.forEach((c) => {
    const id = c.dataset.channel;
    c.classList.toggle('active', state.activeChannel === id);
  });

  if ($('broadcastCount')) {
    $('broadcastCount').textContent = String(getConversation('broadcast').length);
  }

  list.innerHTML = '';
  for (const agent of getAgents()) {
    const btn = document.createElement('button');
    btn.className = `agent-item ${agent.status || 'idle'}${state.activeChannel === agent.id ? ' active' : ''}`;
    btn.dataset.agentId = agent.id;
    const conv = getConversation(agent.id);
    btn.innerHTML = `
      <span class="agent-avatar" style="background:${agent.color}">${escapeHtml(agent.initial)}</span>
      <span class="agent-name">${escapeHtml(agent.name)}</span>
      <span class="agent-status"></span>
      <span class="agent-meta">${conv.length || ''}</span>
    `;
    btn.addEventListener('click', () => {
      selectChannel(agent.id);
    });
    list.appendChild(btn);
  }

  // Footer stats
  const totalMessages = Object.values(state.conversations).reduce((acc, arr) => acc + arr.length, 0);
  if ($('messageCount')) $('messageCount').textContent = String(totalMessages);
  if ($('edgeCount')) $('edgeCount').textContent = String(state.edges.length);
}

function renderChatHeader() {
  const meta = getActiveChannelMeta();
  $('chatTitle').textContent = meta.name;
  $('chatSubtitle').textContent = meta.sub || '';
}

function renderMessages() {
  const meta = getActiveChannelMeta();
  const conv = getConversation(meta.id);
  const container = $('messages');
  container.innerHTML = '';

  if (conv.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <div class="empty-glyph">⊹</div>
      <div class="empty-title">${meta.kind === 'broadcast' ? 'Broadcast channel ready' : `Chat with ${escapeHtml(meta.name)}`}</div>
      <div class="empty-sub">${meta.kind === 'broadcast' ? 'Messages here route to every enabled agent.' : escapeHtml(meta.sub || 'Send a message to start the conversation.')}</div>
    `;
    container.appendChild(empty);
    return;
  }

  for (const m of conv) {
    const row = document.createElement('div');
    const isUser = m.from === 'user';
    row.className = `message ${isUser ? 'from-user' : 'from-agent'}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    if (isUser) {
      avatar.style.background = 'linear-gradient(135deg, #8b5cf6, #06b6d4)';
      avatar.textContent = 'You';
      avatar.style.fontSize = '0.65rem';
    } else {
      const agent = getAgent(m.from);
      avatar.style.background = agent?.color || '#8b5cf6';
      avatar.textContent = agent?.initial || '?';
    }

    const body = document.createElement('div');
    body.className = 'msg-body';

    const metaRow = document.createElement('div');
    metaRow.className = 'msg-meta';
    const name = document.createElement('span');
    name.className = 'msg-name';
    name.textContent = isUser ? 'You' : (getAgent(m.from)?.name || m.from);
    metaRow.appendChild(name);
    if (!isUser && m.to && m.to !== 'user' && m.to !== 'broadcast') {
      const route = document.createElement('span');
      route.className = 'msg-route';
      route.textContent = `→ ${m.to}`;
      metaRow.appendChild(route);
    }
    const time = document.createElement('span');
    time.style.color = 'var(--text-dim)';
    time.textContent = timeAgo(m.timestamp);
    metaRow.appendChild(time);

    const bubble = document.createElement('div');
    bubble.className = `msg-bubble${m.streaming ? ' streaming' : ''}${m.error ? ' msg-error' : ''}`;
    bubble.innerHTML = highlightMentions(m.content || '');

    body.append(metaRow, bubble);
    row.append(avatar, body);
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}

function renderApiStatus() {
  const s = getState().settings;
  const connected = !!(s.endpoint && s.model);
  const el = $('apiStatus');
  if (!el) return;
  el.classList.toggle('connected', connected);
  el.querySelector('.label').textContent = connected ? (s.model.split('/').pop() || s.model) : 'Disconnected';
  if ($('modelBadge')) $('modelBadge').textContent = s.model || 'no model set';
}

function renderLogs() {
  const container = $('logs');
  if (!container) return;
  const logs = getState().logs.slice().reverse();
  container.innerHTML = '';
  if (logs.length === 0) {
    container.innerHTML = '<div style="color: var(--text-dim); padding: 1rem;">No events yet. Send a message to start.</div>';
    return;
  }
  for (const log of logs) {
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = new Date(log.time).toLocaleTimeString();
    line.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level ${log.level}">${log.level}</span>
      <span class="log-msg">${escapeHtml(log.message)}</span>
    `;
    container.appendChild(line);
  }
}

function rerender() {
  renderSidebar();
  if (currentView === 'chat') {
    renderChatHeader();
    renderMessages();
  }
  if (currentView === 'network') renderNetwork();
  if (currentView === 'logs') renderLogs();
  renderApiStatus();
}

onRender(rerender);
onSettingsChange(() => {
  renderSidebar();
  renderAgentEditor();
  renderApiStatus();
});

// Tabs
$$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

// Broadcast channel button
$$('.channel-item').forEach((c) => {
  c.addEventListener('click', () => selectChannel(c.dataset.channel));
});

// Composer
const input = $('composerInput');
const sendBtn = $('sendBtn');

function autoSize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}
input.addEventListener('input', autoSize);

async function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoSize();
  sendBtn.disabled = true;
  try {
    await sendMessage(text);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

sendBtn.addEventListener('click', submit);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

// Clear chat
$('clearChatBtn')?.addEventListener('click', () => {
  if (confirm('Clear this conversation?')) clearActiveConversation();
});

// Clear logs
$('clearLogsBtn')?.addEventListener('click', () => {
  clearLogs();
  renderLogs();
});

// New agent modal
$('addAgentBtn')?.addEventListener('click', () => {
  $('newAgentModal').hidden = false;
});
$$('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $('newAgentModal').hidden = true;
  });
});
$('createAgentBtn')?.addEventListener('click', () => {
  const name = $('newAgentName').value.trim();
  const role = $('newAgentRole').value.trim();
  const systemPrompt = $('newAgentPrompt').value.trim();
  const color = $('newAgentColor').value;
  if (!name) return;
  addAgent({ name, role, systemPrompt, color });
  $('newAgentName').value = '';
  $('newAgentRole').value = '';
  $('newAgentPrompt').value = '';
  $('newAgentColor').value = '#8b5cf6';
  $('newAgentModal').hidden = true;
  rerender();
  renderAgentEditor();
});

// Cursor spotlight
const spotlight = document.querySelector('.cursor-spotlight');
let smx = window.innerWidth / 2, smy = window.innerHeight / 2;
let sx = smx, sy = smy;
let spotActive = false;
window.addEventListener('mousemove', (e) => {
  smx = e.clientX; smy = e.clientY;
  if (!spotActive) { spotlight.classList.add('active'); spotActive = true; }
});
function spot() {
  sx += (smx - sx) * 0.18;
  sy += (smy - sy) * 0.18;
  spotlight.style.left = sx + 'px';
  spotlight.style.top = sy + 'px';
  requestAnimationFrame(spot);
}
spot();

// Settings
wireSettings();
renderAgentEditor();

// Queue
wireQueueUI();
startQueuePolling();
loadQueue();

// Initial render
rerender();
resetPulseCounter();

// Refresh times periodically
setInterval(() => {
  if (currentView === 'chat') renderMessages();
}, 30000);
