import { getState, setSettings, resetAll, exportAll } from './store.js';
import { getAgents, updateAgent, deleteAgent } from './agents.js';
import { testConnection, APIError } from './api.js';

let renderListeners = [];
export function onSettingsChange(fn) { renderListeners.push(fn); }
function emit() { renderListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

function $(id) { return document.getElementById(id); }

function setStatus(msg, kind) {
  const el = $('settingsStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = `settings-status show ${kind}`;
  if (kind === 'success') setTimeout(() => el.classList.remove('show'), 4000);
}

export function loadSettingsToForm() {
  const s = getState().settings;
  if ($('settingEndpoint')) $('settingEndpoint').value = s.endpoint || '';
  if ($('settingApiKey')) $('settingApiKey').value = s.apiKey || '';
  if ($('settingModel')) $('settingModel').value = s.model || '';
  if ($('settingTemp')) {
    $('settingTemp').value = String(s.temperature ?? 0.7);
    $('tempValue').textContent = String(s.temperature ?? 0.7);
  }
}

export function wireSettings() {
  loadSettingsToForm();

  $('settingTemp')?.addEventListener('input', (e) => {
    $('tempValue').textContent = e.target.value;
  });

  $('saveSettingsBtn')?.addEventListener('click', () => {
    setSettings({
      endpoint: $('settingEndpoint').value.trim(),
      apiKey: $('settingApiKey').value.trim(),
      model: $('settingModel').value.trim(),
      temperature: parseFloat($('settingTemp').value),
    });
    setStatus('Saved. Settings persist in this browser only.', 'success');
    emit();
  });

  $('testConnectionBtn')?.addEventListener('click', async () => {
    setSettings({
      endpoint: $('settingEndpoint').value.trim(),
      apiKey: $('settingApiKey').value.trim(),
      model: $('settingModel').value.trim(),
      temperature: parseFloat($('settingTemp').value),
    });
    setStatus('Testing...', 'success');
    try {
      await testConnection();
      setStatus('Connected. Endpoint and model are reachable.', 'success');
      emit();
    } catch (e) {
      const msg = e instanceof APIError ? e.message : (e?.message || 'Unknown error');
      setStatus(`Failed: ${msg}`, 'error');
    }
  });

  $('exportBtn')?.addEventListener('click', () => {
    const data = exportAll();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hermes-agent-os-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('resetBtn')?.addEventListener('click', () => {
    if (confirm('Reset everything? This wipes agents, conversations, edges, logs, and settings.')) {
      resetAll();
      location.reload();
    }
  });
}

export function renderAgentEditor() {
  const container = $('agentEditor');
  if (!container) return;
  const agents = getAgents();
  container.innerHTML = '';

  for (const agent of agents) {
    const card = document.createElement('div');
    card.className = 'agent-card';

    const header = document.createElement('div');
    header.className = 'agent-card-header';

    const avatar = document.createElement('div');
    avatar.className = 'agent-avatar';
    avatar.style.background = agent.color;
    avatar.textContent = agent.initial;

    const nameWrap = document.createElement('div');
    nameWrap.style.flex = '1';
    nameWrap.innerHTML = `<div class="agent-card-name">${escapeHtml(agent.name)}</div><div class="agent-card-role">${escapeHtml(agent.role || '')}</div>`;

    const actions = document.createElement('div');
    actions.className = 'agent-card-actions';
    const editBtn = document.createElement('button');
    editBtn.textContent = card.classList.contains('expanded') ? 'Collapse' : 'Edit';
    editBtn.addEventListener('click', () => {
      card.classList.toggle('expanded');
      editBtn.textContent = card.classList.contains('expanded') ? 'Collapse' : 'Edit';
    });
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => {
      if (confirm(`Delete ${agent.name}?`)) {
        deleteAgent(agent.id);
        emit();
      }
    });
    actions.append(editBtn, delBtn);

    header.append(avatar, nameWrap, actions);

    const promptArea = document.createElement('textarea');
    promptArea.className = 'agent-card-prompt';
    promptArea.value = agent.systemPrompt || '';
    promptArea.addEventListener('change', () => {
      updateAgent(agent.id, { systemPrompt: promptArea.value });
      emit();
    });

    card.append(header, promptArea);
    container.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
