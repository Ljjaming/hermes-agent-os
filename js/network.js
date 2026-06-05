import { getState } from './store.js';
import { getAgents, getAgent } from './agents.js';
import { selectChannel } from './chat.js';

const W = 800;
const H = 600;
const NODE_R = 36;

let lastEdgeIdx = 0;
let activePulses = [];

function svgEl(tag, attrs = {}, children = []) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function layoutNodes() {
  const agents = getAgents();
  const positions = {};
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.32;

  positions['user'] = { x: cx, y: cy, isUser: true };

  agents.forEach((agent, i) => {
    const angle = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
    positions[agent.id] = {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      color: agent.color,
      name: agent.name,
      initial: agent.initial,
      status: agent.status,
    };
  });

  return positions;
}

function renderNodes(positions) {
  const nodeLayer = document.getElementById('nodeLayer');
  if (!nodeLayer) return;
  nodeLayer.innerHTML = '';

  const userPos = positions['user'];
  const userBg = svgEl('circle', {
    class: 'net-node-bg',
    cx: userPos.x,
    cy: userPos.y,
    r: 28,
    fill: '#0d0b18',
    stroke: 'rgba(255,255,255,0.25)',
    'stroke-width': 1.5,
  });
  const userLabel = svgEl('text', {
    class: 'net-node-label',
    x: userPos.x,
    y: userPos.y,
    fill: '#fff',
  });
  userLabel.textContent = 'YOU';
  nodeLayer.append(userBg, userLabel);

  const activeChannel = getState().activeChannel;
  const agents = getAgents();
  agents.forEach((agent) => {
    const pos = positions[agent.id];
    if (!pos) return;
    const group = svgEl('g', {
      class: `net-node-group${activeChannel === agent.id ? ' active' : ''}`,
      transform: `translate(${pos.x}, ${pos.y})`,
      'data-agent-id': agent.id,
    });
    const ringGlow = svgEl('circle', {
      r: NODE_R + 6,
      fill: 'none',
      stroke: agent.color,
      'stroke-width': 1,
      opacity: agent.status === 'thinking' || agent.status === 'speaking' ? 0.7 : 0.3,
      style: agent.status === 'thinking' || agent.status === 'speaking'
        ? 'filter: drop-shadow(0 0 12px currentColor); animation: pulse 1.6s ease-in-out infinite;'
        : 'filter: drop-shadow(0 0 4px currentColor);',
    });
    const bg = svgEl('circle', {
      class: 'net-node-bg',
      r: NODE_R,
      fill: '#0d0b18',
    });
    const ring = svgEl('circle', {
      class: 'net-node-ring',
      r: NODE_R - 2,
      stroke: agent.color,
    });
    const initial = svgEl('text', {
      class: 'net-node-label',
      y: 1,
    });
    initial.textContent = agent.initial;
    const name = svgEl('text', {
      class: 'net-node-name',
      y: NODE_R + 18,
    });
    name.textContent = agent.name;

    group.append(ringGlow, bg, ring, initial, name);
    group.addEventListener('click', () => selectChannel(agent.id));
    nodeLayer.appendChild(group);
  });
}

function renderEdges(positions) {
  const edgeLayer = document.getElementById('edgeLayer');
  if (!edgeLayer) return;
  edgeLayer.innerHTML = '';

  const edges = getState().edges;
  const counts = new Map();
  edges.forEach((e) => {
    const k = [e.from, e.to].sort().join('::');
    counts.set(k, (counts.get(k) || 0) + 1);
  });

  for (const [k, count] of counts.entries()) {
    const [a, b] = k.split('::');
    const pa = positions[a];
    const pb = positions[b];
    if (!pa || !pb) continue;
    const opacity = Math.min(0.05 + count * 0.04, 0.5);
    edgeLayer.appendChild(svgEl('line', {
      class: 'net-edge',
      x1: pa.x, y1: pa.y,
      x2: pb.x, y2: pb.y,
      stroke: 'rgba(255,255,255,0.15)',
      'stroke-width': Math.min(0.5 + count * 0.15, 3),
      opacity,
    }));
  }
}

function spawnPulse(positions, fromId, toId) {
  const from = positions[fromId];
  const to = positions[toId];
  if (!from || !to) return;
  const edgeLayer = document.getElementById('edgeLayer');
  if (!edgeLayer) return;

  const path = svgEl('line', {
    class: 'net-pulse',
    x1: from.x, y1: from.y,
    x2: from.x, y2: from.y,
    stroke: 'url(#edgeGrad)',
  });
  edgeLayer.appendChild(path);

  const start = performance.now();
  const dur = 900;
  function step(now) {
    const t = Math.min((now - start) / dur, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = from.x + (to.x - from.x) * eased;
    const y = from.y + (to.y - from.y) * eased;
    path.setAttribute('x2', x);
    path.setAttribute('y2', y);
    if (t < 1) requestAnimationFrame(step);
    else {
      const fadeStart = performance.now();
      function fade(n) {
        const f = Math.min((n - fadeStart) / 400, 1);
        path.setAttribute('opacity', String(1 - f));
        if (f < 1) requestAnimationFrame(fade);
        else path.remove();
      }
      requestAnimationFrame(fade);
    }
  }
  requestAnimationFrame(step);
}

export function renderNetwork() {
  const positions = layoutNodes();
  renderEdges(positions);
  renderNodes(positions);

  const edges = getState().edges;
  while (lastEdgeIdx < edges.length) {
    const edge = edges[lastEdgeIdx];
    spawnPulse(positions, edge.from, edge.to);
    lastEdgeIdx++;
  }
}

export function resetPulseCounter() {
  lastEdgeIdx = getState().edges.length;
}
