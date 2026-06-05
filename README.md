# Hermes Agent OS

Multi-agent operating system for the Revenue Leak Audit practice. Routes messages between specialized agents, visualizes the communication graph, and runs entirely client-side against any OpenAI-compatible LLM endpoint.

## Stack
- Vanilla HTML / CSS / JS (ES modules, no build step)
- localStorage for persistence
- SVG for the network graph
- Server-Sent Events for streaming responses

## Starter agents
- **Hermes** — orchestrator, routes via @mentions
- **Auditor** — Revenue Leak Audits, Five-Gap framework
- **Researcher** — OSINT, prospect intel
- **Outreach** — cold and warm outreach copy
- **Strategist** — pattern and contradiction analyst
- **Archive** — long-term memory

## First-time setup
1. Open the deployed site (or run a local server).
2. Click **Settings**.
3. Paste your endpoint URL, API key, and model name. The key stays in your browser's localStorage only.
4. Click **Test Connection**, then **Save Settings**.

## Compatible endpoints
Anything that speaks the OpenAI Chat Completions format:
- OpenRouter: `https://openrouter.ai/api/v1` with model `nousresearch/hermes-3-llama-3.1-405b`
- Ollama (local): `http://localhost:11434/v1` with `nous-hermes2` etc.
- HyperBolic, Together, vLLM, OpenAI, Anthropic-compatible proxies, etc.

## Routing
- Select an **agent** in the sidebar to chat 1:1.
- Select **Broadcast** to send to every enabled agent simultaneously.
- Inside any message (yours or an agent's), use `@agent-name` to route a follow-up to another agent. Mentions create visible edges in the Network view.

## Network view
Every routed message draws an animated pulse from sender to receiver. Edge weight grows with frequency, so you can see who talks to whom most.

## Local preview
```powershell
cd C:\Users\Justin\Documents\hermes-agent-os
python -m http.server 8765
```
Open http://localhost:8765.

## Deploy
```powershell
cd C:\Users\Justin\Documents\hermes-agent-os
git init -b main
git add .
git commit -m "Initial Hermes Agent OS"
gh repo create hermes-agent-os --public --source=. --remote=origin --push
gh api -X POST repos/Ljjaming/hermes-agent-os/pages -f "source[branch]=main" -f "source[path]=/"
```
Lives at https://ljjaming.github.io/hermes-agent-os/.
