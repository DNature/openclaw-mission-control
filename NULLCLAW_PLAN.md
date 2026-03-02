# Nullclaw Build Plan
> Branch: `feat/nullclaw-support`
> Goal: Extend nullclaw to reach feature parity with OpenClaw for our specific use case

## Context

Migrating from OpenClaw to nullclaw for resource reasons (~1GB → ~1MB RAM).
Nullclaw is written in Zig, 678KB binary, <2ms startup, 22+ providers, 18 channels.
Missing features are being built out rather than accepting the gaps.

**Dedicated accounts model:** All service accounts (Gmail, GitHub, etc.) are isolated,
purpose-built accounts stored as encrypted credentials in the workspace. No personal
browser attachment needed.

---

## Feature 1 — Browser Control (Lightpanda + zchrome)
**Priority: High**

### Stack
```
nullclaw → zchrome (Zig CDP client) → Lightpanda (Zig headless browser)
```

Pure Zig end-to-end. No Chrome, no Node, no external runtime.

### Why this stack
- **zchrome** (`github.com/shishtpal/zchrome`) — pure Zig CDP client, add as `build.zig.zon` dependency
- **Lightpanda** (`github.com/lightpanda-io/browser`) — headless browser built in Zig, exposes CDP on `:9222`, 11x faster and 9x less memory than Chrome
- Fits nullclaw's lean philosophy perfectly
- Dedicated accounts stored in workspace — no need for personal browser attachment

### Performance vs Chrome/Playwright
| | Chrome + Playwright | Lightpanda + zchrome |
|---|---|---|
| Memory | ~207MB | ~24MB |
| Speed | baseline | 11x faster |
| Startup | seconds | instant |
| Dependencies | Chrome install required | single binary |

### Components to build

**1a. Lightpanda process manager**
- Auto-launch Lightpanda on first browser tool call via nullclaw's exec tool
- Manage as child process with graceful shutdown
- Health check: ping CDP `/json/version` before use
- Configurable port (default `9222`)

**1b. Browser tool (wrapping zchrome)**
- `navigate <url>` — page navigation with wait strategies
- `screenshot` — capture current page state
- `click <ref>` — click by aria ref
- `type <ref> <text>` — fill input by aria ref
- `evaluate <js>` — run JavaScript in page context
- `extract_text` — get visible text content
- `get_links` — extract all links
- `fill_form <fields>` — fill and submit forms
- `get_cookies` / `set_cookies` — session management
- `network_intercept` — intercept/mock requests

**1c. Aria ref system**
- JS snippet injected into page that walks DOM and builds semantic tree
- Assigns stable short refs (`e1`, `e2`...) to interactive elements
- Zig-side ref tracker persists refs across tool calls within a session
- Refs based on aria roles/labels, not coordinates — survives re-renders

**1d. Credential manager**
- Store per-service credentials in `~/.nullclaw/workspace/accounts/<service>.json`
- Encrypted with nullclaw's existing ChaCha20-Poly1305 secrets system
- `login <service>` tool: reads credentials → navigates login page → fills form → persists session cookies to workspace
- Session reuse: on subsequent calls, restore cookies before navigating

### Vibe prompt for Opus
> "Integrate browser automation into nullclaw using zchrome (github.com/shishtpal/zchrome) as the CDP client and Lightpanda as the headless browser backend. Nullclaw should: (1) auto-launch Lightpanda via exec on first browser tool call and manage it as a child process, (2) connect zchrome to Lightpanda's CDP server at `ws://127.0.0.1:9222`, (3) expose browser tools: navigate, screenshot, click, type, evaluate, extract_text, get_links, fill_form, get_cookies, set_cookies. Build an aria-ref system that snapshots interactive elements and assigns stable short refs for multi-step interactions. Store per-service credentials in `~/.nullclaw/workspace/accounts/` encrypted with the existing ChaCha20-Poly1305 secrets system. Implement a `login <service>` tool that reads credentials, fills the login form, and persists session cookies for reuse."

---

## Feature 2 — Web Chat UI (Mission Control adapter)
**Priority: Critical — biggest daily gap**

### Approach
Extend Mission Control (Next.js) to connect to nullclaw's WebSocket channel (`channels.web`)
alongside the existing OpenClaw connection. Dual-backend with a switcher toggle.

### Components to build

**2a. `nullclaw-transport.ts`**
- Mirrors existing `src/lib/transports/` pattern
- Handles nullclaw WebSocket pairing handshake (POST `/pair` with `X-Pairing-Code` → bearer token)
- Reconnection logic with exponential backoff

**2b. `nullclaw-client.ts`**
- HTTP client for nullclaw gateway at `:3000`
- Status, health, webhook endpoints

**2c. Chat view backend switcher**
- Toggle in UI: OpenClaw ↔ Nullclaw
- Persisted in localStorage
- Status badge showing active backend

**2d. `nullclaw-status-store.ts`**
- Reactive store: installed / running / version / reachable
- API route `/api/nullclaw/status`

### Vibe prompt for Opus
> "Extend Mission Control (Next.js, src at `~/openclaw-mission-control/src`) to support nullclaw as a second backend alongside OpenClaw. Create `src/lib/transports/nullclaw-transport.ts` that handles nullclaw's WebSocket pairing handshake (POST `/pair` with `X-Pairing-Code` header, receive bearer token, include in subsequent WebSocket messages). Add a backend switcher toggle to the chat view. Create `src/lib/nullclaw-client.ts` for HTTP calls to `:3000`. Mirror the patterns in `src/lib/transports/auto-transport.ts` and `src/lib/openclaw-client.ts`."

---

## Feature 3 — TTS / Audio
**Priority: Low-Medium**

### Approach
Nullclaw skill that calls ElevenLabs (or OpenAI TTS) and plays audio locally.
Falls back to macOS `say` / Linux `espeak` if no API key.

### Components to build
- Skill: `~/.nullclaw/workspace/skills/tts/SKILL.md`
- Shell script: calls ElevenLabs API → saves mp3 → plays via `afplay` (macOS) / `mpg123` (Linux)
- Config: `voice_id`, `api_key`, `output_device` in nullclaw config
- Incoming voice messages: already partially supported via Groq Whisper in nullclaw config

### Vibe prompt for Opus
> "Create a nullclaw skill for text-to-speech. SKILL.md + a shell script that: (1) accepts text and optional voice_id, (2) POSTs to ElevenLabs `/v1/text-to-speech/{voice_id}` with the API key from nullclaw workspace config, (3) saves mp3 to a temp file in workspace, (4) plays via `afplay` on macOS or `mpg123`/`aplay` on Linux, (5) falls back to `say` (macOS) or `espeak` (Linux) if no API key. Store voice preferences in `~/.nullclaw/workspace/tts-config.json`."

---

## Feature 4 — ACP Harness (Claude Code / Codex bridge)
**Priority: Medium**

### Approach
Nullclaw skill that spawns Claude Code as a subprocess, streams output back,
and reports results. Treats it as an async subagent task.

### Components to build
- Skill: `~/.nullclaw/workspace/skills/acp-bridge/SKILL.md`
- Spawns `claude` CLI in an isolated temp workspace
- Streams stdout back to the agent in chunks via nullclaw's exec tool
- Returns created files + final result
- Timeout handling (configurable, default 10min)

### Vibe prompt for Opus
> "Write a nullclaw skill (SKILL.md + shell script) that acts as an ACP bridge to Claude Code. When invoked with a task description and optional working directory: (1) create an isolated temp workspace under `~/.nullclaw/workspace/acp-sessions/<timestamp>/`, (2) spawn `claude --dangerously-skip-permissions` with the task piped as stdin, (3) stream stdout back to the nullclaw agent as the task runs, (4) on completion, list created/modified files and return a summary. Handle timeouts (default 10min) and non-zero exit codes gracefully."

---

## Feature 5 — Canvas
**Priority: Low — depends on Feature 2 (Web Chat UI)**

### Approach
Canvas panel in Mission Control that listens for nullclaw WebSocket events
of type `canvas_push` and renders HTML in a sandboxed iframe.

### Components to build
- `src/components/nullclaw-canvas-view.tsx` — sandboxed iframe renderer
- WebSocket event handler for `type: 'canvas_push'` messages
- Nullclaw skill: `canvas_push` tool that sends HTML payload via WebSocket
- Route: `src/app/nullclaw/canvas/`

### Vibe prompt for Opus
> "Add a Canvas panel to Mission Control for nullclaw. Listen on the nullclaw WebSocket for messages with `type: 'canvas_push'` containing an `html` payload. Render in a sandboxed iframe with `sandbox='allow-scripts'`. Add a nullclaw skill that lets the agent call a `canvas_push` tool with arbitrary HTML or a React component string. Add the canvas route to the nullclaw section of the sidebar. Model after the OpenClaw canvas patterns in the existing codebase."

---

## Feature 6 — iMessage Bridge
**Priority: Low — macOS only**

### Approach
macOS-only daemon that polls the Messages SQLite DB, forwards new messages
to nullclaw's webhook, and sends replies via AppleScript.

### Components to build
- Go binary: polls `~/Library/Messages/chat.db` every 5s
- Forwards new messages from allowlisted contacts to nullclaw `POST /webhook`
- Receives nullclaw replies and sends via `osascript`
- LaunchAgent plist for autostart
- Requires Full Disk Access permission in macOS Privacy settings

### Vibe prompt for Opus
> "Build a macOS iMessage bridge for nullclaw as a single Go binary. It should: (1) poll `~/Library/Messages/chat.db` every 5 seconds for new messages from a configured allowlist of phone numbers/emails, (2) track last-seen message ID in a state file to avoid duplicates, (3) forward new messages to nullclaw via `POST /webhook` with `Authorization: Bearer <token>`, (4) poll nullclaw for responses and send back via AppleScript (`osascript -e 'tell application \"Messages\"...'`). Include a launchd plist for autostart and setup instructions for granting Full Disk Access."

---

## Feature 7 — Node Pairing (Phone companion)
**Priority: Low**

### Approach
Lightweight Expo React Native app that runs a local HTTP server on the phone,
registers with nullclaw, and exposes camera/location/notifications as REST endpoints.

### Components to build

**7a. Mobile companion app (Expo)**
- Local HTTP server (`expo-server` or similar)
- Endpoints: `GET /camera/snap`, `GET /location`, `POST /notify`, `GET /screen`
- On launch: POST `{ ip, port, token }` to nullclaw `POST /nodes/register`
- QR code pairing flow

**7b. Nullclaw skill**
- Discovers registered nodes from workspace registry
- Wraps node endpoints as agent tools: `camera_snap`, `get_location`, `notify`, `screen_shot`

### Vibe prompt for Opus
> "Design a minimal node pairing system for nullclaw. Part 1: an Expo React Native app that starts a local HTTP server on port 7777, exposes `GET /camera/snap` (returns base64 JPEG), `GET /location` (returns lat/lng), `POST /notify` (shows push notification), and on launch POSTs `{ ip, port, token }` to a nullclaw pairing endpoint with a QR-code-displayed pairing code. Part 2: a nullclaw skill that reads registered nodes from `~/.nullclaw/workspace/nodes.json` and exposes camera_snap, get_location, notify as agent tools via http_request."

---

## Summary

| Feature | Priority | Effort | Status |
|---|---|---|---|
| Web Chat UI (Mission Control) | 🔴 Critical | ~3 days | Not started |
| Browser Control (Lightpanda + zchrome) | 🔴 High | ~4 days | Not started |
| TTS / Audio | 🟡 Medium | ~0.5 days | Not started |
| ACP Harness | 🟡 Medium | ~1 day | Not started |
| Canvas | 🟢 Low | ~1 day | Needs Feature 2 first |
| iMessage | 🟢 Low | ~1 day | macOS only |
| Node Pairing | 🟢 Low | ~3 days | Not started |

## Suggested build order
1. Web Chat UI — unblocks daily use
2. Browser Control — highest utility, pure Zig stack
3. TTS — quick win
4. ACP Harness — coding agent delegation
5. Canvas — depends on #1
6. iMessage — nice to have
7. Node Pairing — nice to have
