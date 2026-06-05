import { getState, appendLog } from './store.js';

export class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function getConfig() {
  const { endpoint, apiKey, model, temperature } = getState().settings;
  return { endpoint, apiKey, model, temperature };
}

function joinUrl(base, path) {
  if (!base) return path;
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function testConnection() {
  const { endpoint, apiKey, model } = getConfig();
  if (!endpoint) throw new APIError('No endpoint configured', 0);
  if (!model) throw new APIError('No model configured', 0);
  const url = joinUrl(endpoint, '/chat/completions');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new APIError(`${res.status} ${res.statusText} ${text.slice(0, 200)}`.trim(), res.status);
  }
  return true;
}

export async function chatCompletion({ messages, onToken, signal }) {
  const { endpoint, apiKey, model, temperature } = getConfig();
  if (!endpoint) throw new APIError('No endpoint configured. Open Settings to set one.', 0);
  if (!model) throw new APIError('No model configured. Open Settings to set one.', 0);

  const url = joinUrl(endpoint, '/chat/completions');
  const body = {
    model,
    messages,
    temperature: typeof temperature === 'number' ? temperature : 0.7,
    stream: true,
  };

  appendLog('info', `POST ${url} model=${model} msgs=${messages.length}`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    appendLog('error', `Network failure: ${e.message}`);
    throw new APIError(`Network failure: ${e.message}`, 0);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    appendLog('error', `HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new APIError(`HTTP ${res.status}: ${text.slice(0, 200)}`.trim(), res.status);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || '';
    if (onToken) onToken(content);
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') break;
      try {
        const json = JSON.parse(data);
        const delta = json?.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          if (onToken) onToken(delta);
        }
      } catch {
        // ignore non-JSON chunks
      }
    }
  }

  return full;
}
