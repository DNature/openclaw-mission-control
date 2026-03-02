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

**Browser stack:** Playwright-compatible (Lightpanda) + zchrome (Zig CDP client).
Most reliable choice — Playwright compatibility is well-tested, zchrome provides
a proper typed CDP layer in Zig.

```
nullclaw → zchrome (Zig CDP client) → Lightpanda (Playwright-compatible headless browser)
```

---

## Feature 1 — Browser Control
**Priority: High | Effort: ~7 days**

### Stack
- **Lightpanda** (`github.com/lightpanda-io/browser`) — headless browser built in Zig, Playwright-compatible, exposes CDP on `:9222`. 11x faster, 9x less memory than Chrome.
- **zchrome** (`github.com/shishtpal/zchrome`) — pure Zig CDP client. Add as `build.zig.zon` dependency. Provides typed, compile-time-safe CDP commands.

### Performance vs Chrome
| | Chrome + Playwright | Lightpanda + zchrome |
|---|---|---|
| Memory | ~207MB | ~24MB |
| Speed | baseline | 11x faster |
| Startup | seconds | instant |
| Chrome dependency | required | none |

---

### Component 1.1 — Process Manager
**Effort: 0.5 days**

Handles Lightpanda's full lifecycle.

- Auto-launch `lightpanda serve --port 9222` on first browser tool call
- Health check: ping CDP `/json/version` before use
- Crash detection + automatic restart with exponential backoff
- Graceful shutdown when nullclaw exits
- Port conflict detection — configurable port, default `9222`
- Single instance enforcement (don't spawn duplicates)

---

### Component 1.2 — Session Manager
**Effort: 1 day**

Manages isolated browser contexts per service account.

- One CDP browser context per account (`Gmail`, `GitHub`, etc.)
- Full isolation: separate cookies, localStorage, history per context
- Context registry stored in `~/.nullclaw/workspace/browser/contexts.json`
- Agent API: `use_session <service>` switches active context
- Idle context timeout — close unused contexts after configurable period
- Context cloning for parallel tasks

---

### Component 1.3 — Credential & Cookie Store
**Effort: 0.5 days**

Persistent, encrypted auth management.

- Store per-service credentials in `~/.nullclaw/workspace/accounts/<service>.json`
- Encrypted with nullclaw's existing ChaCha20-Poly1305 secrets system
- Cookie persistence: save session cookies to `~/.nullclaw/workspace/browser/cookies/<service>.json` after login
- Cookie restore: load cookies before navigating to skip re-login
- Session expiry detection: if a navigation lands on a login page, trigger re-authentication automatically
- `login <service>` tool: reads credentials → navigates login → fills form → saves cookies

---

### Component 1.4 — zchrome CDP Integration
**Effort: 0.5 days**

Core CDP command layer via zchrome.

- Add zchrome as `build.zig.zon` dependency
- Implement nullclaw browser tool wrapping zchrome's typed API
- CDP domains needed:
  - `Page` — navigate, screenshot, PDF, reload
  - `Runtime` — evaluate JavaScript
  - `DOM` — get document, query selectors
  - `Input` — mouse events, keyboard events
  - `Network` — set cookies, intercept requests
  - `Target` — tab/context management
  - `Storage` — localStorage, sessionStorage

---

### Component 1.5 — Aria Ref System
**Effort: 1 day**

Stable element references for reliable multi-step interactions.

- JS snippet injected into page via `Runtime.evaluate` that walks the DOM
- Builds semantic tree: aria roles, labels, placeholder text, tag type, position
- Assigns short stable refs (`e1`, `e2`...) to all interactive elements
- Zig-side ref tracker persists the map across tool calls within a session
- Refs survive minor DOM changes (re-keyed by aria label/role, not position)
- `snapshot` tool: returns current aria tree + screenshot for agent orientation
- Ref invalidation: detect stale refs and trigger re-snapshot automatically

---

### Component 1.6 — Wait Strategies
**Effort: 0.5 days**

Page interaction reliability layer.

- `wait_for_navigation` — wait for `Page.loadEventFired` or `networkIdle`
- `wait_for_element <ref>` — poll DOM until element appears, configurable timeout
- `wait_for_network_idle` — no pending XHR/fetch for N ms
- `wait_for_text <string>` — poll until specific text appears in DOM
- `wait_for_url <pattern>` — wait until URL matches pattern (useful after form submit)
- Global timeout config (default 30s), per-call override

---

### Component 1.7 — Action Retry & Error Recovery
**Effort: 0.5 days**

Graceful handling of the inevitable failures.

- Retry with exponential backoff on element-not-found (3 attempts default)
- Re-snapshot aria tree if refs become stale before retry
- Reconnect to Lightpanda CDP if WebSocket drops
- Restart Lightpanda process if reconnect fails
- Structured error responses: `{ error, reason, suggestion }` so agent can adapt
- Dead page detection: blank page / error page → alert agent

---

### Component 1.8 — Form Intelligence
**Effort: 1 day**

Smart form detection and filling beyond raw click/type.

- Auto-detect all fields in a form: inputs, selects, checkboxes, radio buttons, textareas
- Map field labels/placeholders to a field dictionary
- `fill_form <fields>` tool: accepts key-value pairs, matches to fields intelligently
- Dropdown handling: select by visible text or value
- Checkbox/radio: toggle by label
- File upload: accepts workspace path, triggers file input
- Submit detection: find and click the right submit button
- CAPTCHA detection: flag to agent when encountered (no auto-solve)
- Form validation error detection: surface error messages back to agent

---

### Component 1.9 — Network Interception
**Effort: 0.5 days**

Control over network traffic for speed and data extraction.

- Block ad/tracker domains (static blocklist) — faster page loads, less noise
- Capture XHR/fetch API responses — extract structured JSON data without HTML scraping
- Request mocking: override specific endpoints with static responses
- Custom headers: inject auth headers, user-agent spoofing
- Response logging: store captured API responses to workspace for agent reference

---

### Component 1.10 — Tab Manager
**Effort: 0.5 days**

Multi-tab handling within a session.

- Open new tabs, switch between them by index or title
- Close tabs, list open tabs
- Handle popups and `window.open()` events — auto-capture or dismiss
- Background tab navigation (navigate without switching focus)
- Tab state tracking: URL, title, loading status per tab

---

### Component 1.11 — Download Handler
**Effort: 0.5 days**

Capture files the agent triggers during automation.

- Intercept download events via CDP `Page.setDownloadBehavior`
- Save to `~/.nullclaw/workspace/downloads/<timestamp>-<filename>`
- Return file path to agent on completion
- Support: PDF, CSV, JSON, images, zip archives
- Download timeout + progress reporting

---

### Full Browser Component Map

```
nullclaw browser tool
├── 1.1 Process Manager       → launch/supervise Lightpanda
├── 1.2 Session Manager       → isolated contexts per account
├── 1.3 Credential Store      → encrypted creds + cookie persistence
├── 1.4 zchrome CDP client    → typed CDP commands to Lightpanda
│   ├── 1.10 Tab Manager      → multi-tab handling
│   ├── 1.6  Wait Strategies  → navigation/element/network idle
│   ├── 1.9  Network Layer    → interception, blocking, capture
│   └── 1.11 Download Handler → file save to workspace
├── 1.5 Aria Ref System       → JS snapshot + Zig ref tracker
├── Visual Feedback           → screenshot + aria tree for agent
├── 1.8 Form Intelligence     → smart form detection + filling
└── 1.7 Retry & Recovery      → error handling, reconnection
```

### Vibe prompt for Opus
> "Build a complete browser automation system for nullclaw using Lightpanda as the headless browser and zchrome (github.com/shishtpal/zchrome) as the Zig CDP client. Components: (1) Process manager that auto-launches `lightpanda serve --port 9222` and supervises it with restart on crash. (2) Session manager with isolated CDP contexts per service account, stored in workspace. (3) Credential and cookie store encrypted with ChaCha20-Poly1305, with auto re-login on session expiry. (4) zchrome integration wrapping Page, Runtime, DOM, Input, Network, Target CDP domains. (5) Aria ref system: inject JS to build semantic element tree, assign stable short refs, track across tool calls in Zig. (6) Wait strategies: navigation, element, network idle, text, URL pattern. (7) Retry and recovery: backoff on element-not-found, CDP reconnection, Lightpanda restart. (8) Form intelligence: auto-detect fields, fill by label, handle dropdowns/checkboxes/file uploads, detect CAPTCHA and validation errors. (9) Network interception: ad blocking, XHR capture, request mocking. (10) Tab manager: open/switch/close tabs, handle popups. (11) Download handler: intercept downloads, save to workspace. All credentials stored in `~/.nullclaw/workspace/accounts/` encrypted. Session cookies persisted in `~/.nullclaw/workspace/browser/cookies/`."

---

## Feature 2 — Web Chat UI (Mission Control adapter)
**Priority: Critical | Effort: ~3 days**

Extend Mission Control (Next.js) to connect to nullclaw's WebSocket channel
alongside OpenClaw. Dual-backend with a switcher toggle.

### Components

**2.1 `nullclaw-transport.ts`**
- Mirrors `src/lib/transports/` pattern
- Handles nullclaw WebSocket pairing handshake
- POST `/pair` with `X-Pairing-Code` → bearer token
- Reconnection with exponential backoff

**2.2 `nullclaw-client.ts`**
- HTTP client for nullclaw gateway at `:3000`
- Status, health, webhook endpoints

**2.3 Backend switcher**
- Toggle in chat view: OpenClaw ↔ Nullclaw
- Persisted in localStorage
- Status badge showing active backend + connection state

**2.4 `nullclaw-status-store.ts`**
- Reactive store: installed / running / version / reachable
- API route `/api/nullclaw/status`

### Vibe prompt for Opus
> "Extend Mission Control (Next.js, `~/openclaw-mission-control/src`) to support nullclaw as a second backend alongside OpenClaw. Create `src/lib/transports/nullclaw-transport.ts` handling nullclaw's WebSocket pairing handshake (POST `/pair` with `X-Pairing-Code`, receive bearer token, include in subsequent WebSocket messages). Add a backend switcher toggle to the chat view with a status badge. Create `src/lib/nullclaw-client.ts` for HTTP calls to `:3000`. Mirror patterns in `src/lib/transports/auto-transport.ts` and `src/lib/openclaw-client.ts`."

---

## Feature 3 — TTS / Audio
**Priority: Low-Medium | Effort: ~0.5 days**

Nullclaw skill for text-to-speech via ElevenLabs with local fallback.

### Components
- Skill: `~/.nullclaw/workspace/skills/tts/SKILL.md`
- Shell script: ElevenLabs API → mp3 → `afplay` (macOS) / `mpg123` (Linux)
- Fallback: `say` (macOS) / `espeak` (Linux) if no API key
- Config: `voice_id`, `api_key`, `output_device` in workspace config
- Incoming voice: Groq Whisper transcription already supported in nullclaw config

### Vibe prompt for Opus
> "Create a nullclaw skill for text-to-speech. SKILL.md + shell script that: (1) accepts text + optional voice_id, (2) POSTs to ElevenLabs `/v1/text-to-speech/{voice_id}`, (3) saves mp3 to temp file in workspace, (4) plays via `afplay` (macOS) or `mpg123`/`aplay` (Linux), (5) falls back to `say` (macOS) or `espeak` (Linux) if no API key. Store config in `~/.nullclaw/workspace/tts-config.json`."

---

## Feature 4 — ACP Harness (Claude Code / Codex bridge)
**Priority: Medium | Effort: ~1 day**

Nullclaw skill that spawns Claude Code as a subprocess and streams results back.

### Components
- Skill: `~/.nullclaw/workspace/skills/acp-bridge/SKILL.md`
- Isolated temp workspace per session: `~/.nullclaw/workspace/acp-sessions/<timestamp>/`
- Spawns `claude --dangerously-skip-permissions` with task piped as stdin
- Streams stdout back to agent in chunks
- Returns created/modified files + final summary
- Configurable timeout (default 10min)

### Vibe prompt for Opus
> "Write a nullclaw skill (SKILL.md + shell script) acting as an ACP bridge to Claude Code. When invoked with a task: (1) create isolated workspace `~/.nullclaw/workspace/acp-sessions/<timestamp>/`, (2) spawn `claude --dangerously-skip-permissions` with task piped as stdin, (3) stream stdout back to agent in chunks, (4) on completion list created/modified files and return summary. Handle timeouts (default 10min) and non-zero exit codes gracefully."

---

## Feature 5 — Canvas
**Priority: Low | Effort: ~1 day**
**Depends on: Feature 2**

Canvas panel in Mission Control that renders HTML pushed by nullclaw agent.

### Components
- `src/components/nullclaw-canvas-view.tsx` — sandboxed iframe renderer
- WebSocket event handler for `type: 'canvas_push'` messages
- Nullclaw skill: `canvas_push` tool sending HTML payload via WebSocket
- Route: `src/app/nullclaw/canvas/`

### Vibe prompt for Opus
> "Add a Canvas panel to Mission Control for nullclaw. Listen on the nullclaw WebSocket for `type: 'canvas_push'` messages containing an `html` payload. Render in a sandboxed iframe with `sandbox='allow-scripts'`. Add a nullclaw skill exposing a `canvas_push` tool with arbitrary HTML. Add to the nullclaw sidebar section. Model after OpenClaw canvas patterns in the existing codebase."

---

## Feature 6 — iMessage Bridge
**Priority: Low | Effort: ~1 day**
**macOS only**

Daemon that bridges iMessage ↔ nullclaw via Messages SQLite DB + AppleScript.

### Components
- Go binary polling `~/Library/Messages/chat.db` every 5s
- Forwards new messages from allowlisted contacts to nullclaw `POST /webhook`
- Sends replies back via `osascript`
- State file tracking last-seen message ID
- LaunchAgent plist for autostart
- Requires Full Disk Access in macOS Privacy settings

### Vibe prompt for Opus
> "Build a macOS iMessage bridge for nullclaw as a Go binary. (1) Poll `~/Library/Messages/chat.db` every 5s for new messages from a configured allowlist, (2) track last-seen message ID in a state file, (3) forward new messages to nullclaw `POST /webhook` with `Authorization: Bearer <token>`, (4) send replies via AppleScript `osascript -e 'tell application \"Messages\"...'`. Include launchd plist and Full Disk Access setup instructions."

---

## Feature 7 — Node Pairing (Phone companion)
**Priority: Low | Effort: ~3 days**

Lightweight mobile app + nullclaw skill for camera, location, and notifications.

### Components

**7.1 Expo React Native companion app**
- Local HTTP server on port `7777`
- `GET /camera/snap` — returns base64 JPEG
- `GET /location` — returns lat/lng
- `POST /notify` — shows push notification
- On launch: POST `{ ip, port, token }` to nullclaw `/nodes/register`
- QR code pairing flow

**7.2 Nullclaw skill**
- Reads registered nodes from `~/.nullclaw/workspace/nodes.json`
- Exposes `camera_snap`, `get_location`, `notify` as agent tools via `http_request`

### Vibe prompt for Opus
> "Design a minimal node pairing system for nullclaw. Part 1: Expo React Native app with a local HTTP server on port 7777 exposing `GET /camera/snap` (base64 JPEG), `GET /location` (lat/lng), `POST /notify` (push notification). On launch POST `{ ip, port, token }` to nullclaw pairing endpoint shown as QR code. Part 2: nullclaw skill reading registered nodes from `~/.nullclaw/workspace/nodes.json` and exposing camera_snap, get_location, notify as agent tools via http_request."

---

## Full Build Summary

| # | Feature | Priority | Effort | Depends On |
|---|---|---|---|---|
| 1 | Browser Control (Lightpanda + zchrome) | 🔴 High | ~7 days | — |
| 1.1 | Process Manager | 🔴 | 0.5d | — |
| 1.2 | Session Manager | 🔴 | 1d | 1.1 |
| 1.3 | Credential & Cookie Store | 🔴 | 0.5d | — |
| 1.4 | zchrome CDP Integration | 🔴 | 0.5d | 1.1 |
| 1.5 | Aria Ref System | 🔴 | 1d | 1.4 |
| 1.6 | Wait Strategies | 🟡 | 0.5d | 1.4 |
| 1.7 | Retry & Recovery | 🟡 | 0.5d | 1.4, 1.5 |
| 1.8 | Form Intelligence | 🟡 | 1d | 1.4, 1.5 |
| 1.9 | Network Interception | 🟡 | 0.5d | 1.4 |
| 1.10 | Tab Manager | 🟡 | 0.5d | 1.4 |
| 1.11 | Download Handler | 🟢 | 0.5d | 1.4 |
| 2 | Web Chat UI (Mission Control) | 🔴 Critical | ~3 days | — |
| 3 | TTS / Audio | 🟡 Medium | ~0.5 days | — |
| 4 | ACP Harness | 🟡 Medium | ~1 day | — |
| 5 | Canvas | 🟢 Low | ~1 day | Feature 2 |
| 6 | iMessage Bridge | 🟢 Low | ~1 day | — |
| 7 | Node Pairing | 🟢 Low | ~3 days | — |
| | **Total** | | **~16.5 days** | |

---

## Suggested Build Order

```
Week 1
  Day 1-2:  Feature 2  — Web Chat UI (unblocks daily use immediately)
  Day 3:    Feature 3  — TTS (quick win)
            Feature 4  — ACP Harness (quick win)

Week 2
  Day 4:    1.1 Process Manager + 1.3 Credential Store
  Day 5:    1.4 zchrome CDP Integration
  Day 6:    1.2 Session Manager
  Day 7:    1.5 Aria Ref System

Week 3
  Day 8:    1.6 Wait Strategies + 1.7 Retry & Recovery
  Day 9:    1.8 Form Intelligence
  Day 10:   1.9 Network Interception + 1.10 Tab Manager + 1.11 Download Handler

Week 4
  Day 11:   Feature 5  — Canvas
  Day 12-13: Feature 7 — Node Pairing
  Day 14:   Feature 6  — iMessage Bridge
```
