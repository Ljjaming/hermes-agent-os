const KEY = 'hermes-agent-os-v1';

const DEFAULT_STATE = {
  agents: [],
  conversations: {},
  edges: [],
  logs: [],
  settings: {
    endpoint: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    airtable_pat: '',
    airtable_base_id: '',
  },
  activeChannel: 'broadcast',
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to persist state', e);
  }
}

export function getState() {
  return state;
}

export function setActiveChannel(channelId) {
  state.activeChannel = channelId;
  save();
}

export function getConversation(channelId) {
  if (!state.conversations[channelId]) state.conversations[channelId] = [];
  return state.conversations[channelId];
}

export function appendMessage(channelId, message) {
  const conv = getConversation(channelId);
  conv.push(message);
  save();
  return message;
}

export function clearConversation(channelId) {
  state.conversations[channelId] = [];
  save();
}

export function appendEdge(edge) {
  state.edges.push(edge);
  if (state.edges.length > 500) state.edges = state.edges.slice(-500);
  save();
}

export function appendLog(level, message) {
  const line = { time: Date.now(), level, message };
  state.logs.push(line);
  if (state.logs.length > 1000) state.logs = state.logs.slice(-1000);
  save();
  return line;
}

export function clearLogs() {
  state.logs = [];
  save();
}

export function setSettings(settings) {
  state.settings = { ...state.settings, ...settings };
  save();
}

export function setAgents(agents) {
  state.agents = agents;
  save();
}

export function resetAll() {
  state = structuredClone(DEFAULT_STATE);
  localStorage.removeItem(KEY);
}

export function exportAll() {
  return JSON.stringify(state, null, 2);
}
