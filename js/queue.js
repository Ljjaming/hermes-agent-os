import { getState } from './store.js';
import { appendLog } from './store.js';

const BASE_API = 'https://api.airtable.com/v0';

let queueState = { items: [], filter: 'all', loading: false, error: null };
let pollTimer = null;

function getConfig() {
  const s = getState().settings;
  return { pat: s.airtable_pat, baseId: s.airtable_base_id };
}

function authHeaders() {
  const { pat } = getConfig();
  return { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function fetchPending() {
  const { pat, baseId } = getConfig();
  if (!pat || !baseId) throw new Error('Airtable not configured');
  const formula = encodeURIComponent("({status}='pending')");
  const url = `${BASE_API}/${baseId}/ApprovalQueue?filterByFormula=${formula}&pageSize=100&sort%5B0%5D%5Bfield%5D=time_pending_hours&sort%5B0%5D%5Bdirection%5D=desc`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Airtable ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.records || [];
}

async function patchItem(id, fields) {
  const { baseId } = getConfig();
  const res = await fetch(`${BASE_API}/${baseId}/ApprovalQueue/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Airtable ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function approveItem(id, finalContent) {
  const fields = {
    status: 'approved',
    decided_at: new Date().toISOString(),
    decision_by: 'justin',
  };
  if (finalContent) fields.final_content = finalContent;
  return patchItem(id, fields);
}

export async function killItem(id) {
  return patchItem(id, {
    status: 'killed',
    decided_at: new Date().toISOString(),
    decision_by: 'justin',
  });
}

export async function editAndApproveItem(id, finalContent) {
  return patchItem(id, {
    status: 'edited',
    decided_at: new Date().toISOString(),
    decision_by: 'justin',
    final_content: finalContent,
  });
}

function badgeColor(type) {
  switch (type) {
    case 'outreach_send': return '#f59e0b';
    case 'audit_deliverable': return '#f43f5e';
    case 'reply_send': return '#06b6d4';
    case 'reply_classification': return '#a78bfa';
    case 'content_post': return '#84cc16';
    default: return '#8b5cf6';
  }
}

function badgeLabel(type) {
  const map = {
    outreach_send: 'Outreach',
    audit_deliverable: 'Audit',
    reply_send: 'Reply',
    reply_classification: 'Inbox',
    content_post: 'Content',
  };
  return map[type] || type;
}

function ageLabel(hours) {
  if (hours == null || isNaN(hours)) return '';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function renderEmpty(container, glyph, title, sub) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-glyph">${glyph}</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <div class="empty-sub">${escapeHtml(sub)}</div>
    </div>`;
}

function buildCard(record) {
  const f = record.fields;
  const card = document.createElement('article');
  const ageStatus = (f.age_status || 'fresh').toString();
  card.className = `queue-card age-${ageStatus}`;
  card.dataset.id = record.id;
  card.dataset.type = f.type || '';

  const badge = badgeLabel(f.type);
  const color = badgeColor(f.type);
  const age = ageLabel(f.time_pending_hours);
  const prospect = (f.prospect && f.prospect.length) ? `Prospect ID: ${f.prospect[0]}` : '';
  const draft = (f.draft_content || '').slice(0, 600);

  card.innerHTML = `
    <header class="queue-card-header">
      <div class="queue-badges">
        <span class="queue-type-badge" style="background:${color}">${escapeHtml(badge)}</span>
        ${age ? `<span class="queue-age-badge age-${ageStatus}">${escapeHtml(age)}</span>` : ''}
        ${f.priority && f.priority !== 'normal' ? `<span class="queue-priority-badge">${escapeHtml(f.priority)}</span>` : ''}
      </div>
      <div class="queue-card-title">${escapeHtml(f.title || 'Untitled')}</div>
      ${prospect ? `<div class="queue-card-sub">${escapeHtml(prospect)}</div>` : ''}
    </header>
    <div class="queue-card-body">
      <pre class="queue-draft">${escapeHtml(draft)}${(f.draft_content || '').length > 600 ? '\n\n[truncated]' : ''}</pre>
      <textarea class="queue-edit" hidden>${escapeHtml(f.draft_content || '')}</textarea>
    </div>
    <footer class="queue-card-actions">
      <button class="btn btn-primary queue-approve">Approve</button>
      <button class="btn btn-ghost queue-edit-toggle">Edit</button>
      <button class="btn btn-danger queue-kill">Kill</button>
    </footer>
  `;

  const approveBtn = card.querySelector('.queue-approve');
  const editToggle = card.querySelector('.queue-edit-toggle');
  const killBtn = card.querySelector('.queue-kill');
  const draftEl = card.querySelector('.queue-draft');
  const editEl = card.querySelector('.queue-edit');

  let editing = false;
  editToggle.addEventListener('click', () => {
    editing = !editing;
    if (editing) {
      draftEl.hidden = true;
      editEl.hidden = false;
      editEl.focus();
      editToggle.textContent = 'Cancel';
      approveBtn.textContent = 'Save + Approve';
    } else {
      draftEl.hidden = false;
      editEl.hidden = true;
      editToggle.textContent = 'Edit';
      approveBtn.textContent = 'Approve';
    }
  });

  approveBtn.addEventListener('click', async () => {
    setBusy(card, true);
    try {
      if (editing) {
        await editAndApproveItem(record.id, editEl.value);
      } else {
        await approveItem(record.id);
      }
      card.classList.add('decided');
      appendLog('send', `Queue approve: ${f.type} ${record.id}`);
      setTimeout(() => card.remove(), 400);
      updateBadge();
    } catch (e) {
      appendLog('error', `Queue approve failed: ${e.message}`);
      setBusy(card, false);
      alert(`Failed: ${e.message}`);
    }
  });

  killBtn.addEventListener('click', async () => {
    if (!confirm('Kill this item? It will not send.')) return;
    setBusy(card, true);
    try {
      await killItem(record.id);
      card.classList.add('decided');
      appendLog('info', `Queue kill: ${f.type} ${record.id}`);
      setTimeout(() => card.remove(), 400);
      updateBadge();
    } catch (e) {
      appendLog('error', `Queue kill failed: ${e.message}`);
      setBusy(card, false);
      alert(`Failed: ${e.message}`);
    }
  });

  return card;
}

function setBusy(card, busy) {
  card.classList.toggle('busy', busy);
  card.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
}

function updateBadge() {
  const badge = document.getElementById('queueBadge');
  if (!badge) return;
  const count = queueState.items.filter((i) => i.fields.status === 'pending').length;
  badge.textContent = String(count);
  badge.hidden = count === 0;
  badge.classList.toggle('overdue', queueState.items.some((i) => i.fields.age_status === 'overdue'));
}

function renderList() {
  const container = document.getElementById('queueList');
  if (!container) return;

  if (queueState.loading) {
    renderEmpty(container, '⟲', 'Loading queue...', 'Reading from Airtable.');
    return;
  }
  if (queueState.error) {
    renderEmpty(container, '⚠', 'Failed to load queue', queueState.error);
    return;
  }

  const filtered = queueState.filter === 'all'
    ? queueState.items
    : queueState.items.filter((i) => i.fields.type === queueState.filter);

  if (filtered.length === 0) {
    renderEmpty(container, '✓', 'Queue is clear', queueState.filter === 'all' ? 'No items pending. Either you cleared it, or agents have not drafted anything yet.' : 'No items in this category.');
    return;
  }

  container.innerHTML = '';
  for (const record of filtered) {
    container.appendChild(buildCard(record));
  }
}

export async function loadQueue() {
  const container = document.getElementById('queueList');
  if (!container) return;

  const { pat, baseId } = getConfig();
  if (!pat || !baseId) {
    renderEmpty(container, '⚙', 'Airtable not configured', 'Add your Personal Access Token and Base ID in Settings to load the queue.');
    const badge = document.getElementById('queueBadge');
    if (badge) badge.hidden = true;
    return;
  }

  queueState.loading = true;
  renderList();
  try {
    queueState.items = await fetchPending();
    queueState.error = null;
  } catch (e) {
    queueState.error = e.message;
    appendLog('error', `Queue load failed: ${e.message}`);
  } finally {
    queueState.loading = false;
  }
  renderList();
  updateBadge();
}

export function setQueueFilter(filter) {
  queueState.filter = filter;
  document.querySelectorAll('.filter-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.filter === filter);
  });
  renderList();
}

export function startQueuePolling() {
  stopQueuePolling();
  pollTimer = setInterval(() => {
    if (document.querySelector('.view-queue.active')) loadQueue();
  }, 60000);
}

export function stopQueuePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function wireQueueUI() {
  document.querySelectorAll('#queueFilters .filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => setQueueFilter(pill.dataset.filter));
  });
  document.getElementById('refreshQueueBtn')?.addEventListener('click', () => loadQueue());
}
