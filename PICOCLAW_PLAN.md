# Picoclaw Support Plan
> Branch: `feat/picoclaw-support`

## Overview

Add first-class picoclaw support to Mission Control so users can manage both OpenClaw and picoclaw instances from a single UI. Picoclaw runs as a separate Go-based process on `127.0.0.1:18790` (OpenClaw uses `18789`) with its own config at `~/.picoclaw/config.json` and workspace at `~/.picoclaw/workspace/`.

---

## Phase 1 — Detection & Connection

**Goal:** Mission Control knows if picoclaw is installed, running, and reachable.

### Tasks
- [ ] `src/lib/picoclaw-cli.ts` — wrapper for `picoclaw` CLI commands (mirrors `openclaw-cli.ts`)
- [ ] `src/lib/picoclaw-client.ts` — HTTP client for picoclaw gateway at `:18790` (mirrors `openclaw-client.ts`)
- [ ] `src/lib/picoclaw-status-store.ts` — reactive store: installed / running / version / reachable
- [ ] API route `src/app/api/picoclaw/status/route.ts` — returns `{ installed, running, version, gatewayUrl }`
- [ ] Detection logic: run `picoclaw version` + ping `:18790/health` (or equivalent)

---

## Phase 2 — Config Management

**Goal:** Read and edit `~/.picoclaw/config.json` from the UI.

### Tasks
- [ ] API route `src/app/api/picoclaw/config/route.ts` — GET/PATCH config file
- [ ] `src/components/picoclaw-config-view.tsx` — config editor with sections:
  - **Model** — default model selector (driven by `model_list`)
  - **API Keys** — per-provider key fields (masked input, save to config)
  - **Workspace** — path, `restrict_to_workspace` toggle
  - **Heartbeat** — enabled toggle + interval
  - **Gateway** — host/port display (read-only, with conflict warning if clashing with OpenClaw)
  - **Channels** — enable/disable Telegram, Discord, WhatsApp, etc. with token fields
- [ ] API route `src/app/api/picoclaw/onboard/route.ts` — trigger `picoclaw onboard` for first-time setup
- [ ] Conflict detector: warn if picoclaw gateway port collides with OpenClaw

---

## Phase 3 — Runtime Control

**Goal:** Start/stop/restart picoclaw gateway from the UI.

### Tasks
- [ ] API route `src/app/api/picoclaw/gateway/route.ts` — POST `{ action: start | stop | restart }`
- [ ] Use `picoclaw gateway` command, manage as background process (track PID)
- [ ] `src/components/picoclaw-runtime-controls.tsx` — Start / Stop / Restart buttons with live status
- [ ] Log streaming: tail picoclaw gateway output in a terminal-like view (reuse `terminal-view.tsx` pattern)

---

## Phase 4 — Dashboard Integration

**Goal:** Picoclaw gets a dedicated section in the sidebar and a summary card on the dashboard.

### Tasks
- [ ] Add **Picoclaw** section to `src/components/sidebar.tsx`
  - Status badge (running / stopped / not installed)
  - Sub-items: Config, Channels, Models, Logs
- [ ] `src/app/picoclaw/` — page routes mirroring the OpenClaw section structure
- [ ] Dashboard card on `src/app/dashboard/` showing:
  - Running status
  - Active model
  - Enabled channels
  - Quick start/stop toggle
- [ ] `src/components/picoclaw-status-card.tsx`

---

## Phase 5 — Model & Provider Management

**Goal:** Manage picoclaw's `model_list` and set the default model.

### Tasks
- [ ] `src/components/picoclaw-models-view.tsx` — list all models in `model_list`
  - Add / edit / remove entries
  - API key field per model (masked)
  - Set as default button
- [ ] Reuse `model-picker.tsx` pattern where applicable
- [ ] API key validation: test a model with a quick ping before saving

---

## Phase 6 — Cron / Scheduled Tasks

**Goal:** View and manage picoclaw cron jobs from the UI.

### Tasks
- [ ] API route `src/app/api/picoclaw/cron/route.ts` — wraps `picoclaw cron list/add/remove`
- [ ] `src/app/picoclaw/cron/` page — reuse patterns from `src/app/cron/`
- [ ] `src/components/picoclaw-tasks-view.tsx`

---

## Phase 7 — Memory & Workspace

**Goal:** Browse picoclaw workspace files (MEMORY.md, SOUL.md, sessions, etc.)

### Tasks
- [ ] API route `src/app/api/picoclaw/workspace/route.ts` — read/write files in `~/.picoclaw/workspace/`
- [ ] `src/app/picoclaw/memory/` page — view/edit MEMORY.md, daily notes
- [ ] `src/app/picoclaw/workspace/` page — file browser for workspace

---

## Non-Goals (for now)
- Chat interface for picoclaw (it has its own CLI + channel integrations)
- Cross-agent session bridging between OpenClaw and picoclaw
- Auto-installing picoclaw (user installs it; Mission Control manages it)

---

## Key Differences vs OpenClaw to Keep in Mind

| | OpenClaw | Picoclaw |
|---|---|---|
| Language | TypeScript/Node | Go |
| Gateway port | 18789 | 18790 |
| Config | `~/.openclaw/openclaw.json` | `~/.picoclaw/config.json` |
| Workspace | `~/.openclaw/workspace/` | `~/.picoclaw/workspace/` |
| API keys | Keychain-backed | Plaintext in config.json |
| Auth | Profile-based | Direct in model_list |

---

## Suggested Delivery Order

1. Phase 1 (detection) → unblocks everything
2. Phase 2 (config) → most user value immediately
3. Phase 4 (dashboard) → visible integration
4. Phase 3 (runtime control) → quality of life
5. Phase 5 (models) → polish
6. Phases 6 & 7 → nice to have
