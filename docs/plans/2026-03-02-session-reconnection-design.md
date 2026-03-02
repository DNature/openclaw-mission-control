# Gateway Session Reconnection from Chat UI

**Date:** 2026-03-02
**Status:** Approved

## Problem

The chat UI generates a fresh session key on every page load and provides no way to resume previous gateway sessions. Users lose their conversation context when they navigate away or refresh.

The gateway already persists sessions with full metadata and exposes `chat.history` RPC for fetching message history. This data is used by cron, subagents, and memory graph — but never surfaced in the chat UI.

## Solution

Add a session dropdown in the chat header that lists active gateway sessions for the selected agent. Selecting a session fetches its message history via `chat.history` and reconnects the chat to that session key.

## Architecture

### New API Route

`GET /api/chat/history?sessionKey=...&limit=100`

- Calls `gatewayCall("chat.history", { sessionKey, limit })` with a 10s timeout
- Transforms gateway message format to Vercel AI SDK `Message[]` format
- Returns `{ messages: Message[] }`

### Message Format Transformation

Gateway format:
```typescript
{ role: "user" | "assistant" | "toolResult", content: [{ type: "text", text: "..." }], timestamp: number }
```

AI SDK format:
```typescript
{ id: string, role: "user" | "assistant", content: string, createdAt?: Date }
```

Rules:
- `role: "toolResult"` messages are filtered out (internal, not displayed)
- `content` array text fields are concatenated into a single string
- `timestamp` becomes `createdAt: new Date(timestamp)`
- `id` generated from index
- Empty-text messages are filtered out
- Default limit: 100 messages

### Session List

Reuses existing `/api/sessions` data (already polled). Filtered client-side by `key.startsWith(\`agent:${selectedAgent}:\`)`.

No new polling or API calls for the list itself.

## UI Design

### Session Dropdown

Placed in the chat header, next to the existing agent dropdown.

```
[🤖 Main ▾]  [📋 3m ago ▾]  [Agent setup: claude]
              ┌──────────────────────────┐
              │ ✚ New Chat               │
              │──────────────────────────│
              │ ● 3m ago · 1.2k tokens   │  ← current
              │   12m ago · 4.5k tokens   │
              │   2h ago · 890 tokens     │
              │   5h ago · 3.1k tokens    │
              └──────────────────────────┘
```

Each item shows:
- Relative time (e.g., "3m ago")
- Token count (indicates conversation length)
- Active indicator dot for current session

"New Chat" at the top starts a fresh session with a new key.

### States

- **Loading:** Spinner in chat area while `chat.history` is fetched
- **Empty:** "No previous sessions" with just "New Chat"
- **Gateway unavailable:** Dropdown disabled with "Unavailable" label

## Behavior

1. User opens session dropdown
2. Sees sessions for the current agent, sorted by most recent
3. Selects a session
4. Frontend calls `/api/chat/history?sessionKey=...`
5. Messages are transformed and set via `setMessages()`
6. `chatSessionKey` is updated to the selected session key
7. Subsequent messages continue within the same gateway session

### "New Chat"
- Generates fresh `chatSessionKey` via `createChatSessionKey(agentId)`
- Clears messages array
- Same behavior as current clear-chat

### Constraints
- Session switching disabled during active streaming response
- On `chat.history` failure: show toast, stay on current session, don't change state
- On empty history: switch to session key, show empty chat (agent still has context)

## Files to Modify

1. **`src/app/api/chat/history/route.ts`** (new) — API route wrapping `chat.history` RPC
2. **`src/components/chat-view.tsx`** — Session dropdown UI, reconnection logic, session state management

## Dependencies

None. Uses existing gateway RPC infrastructure and session data.
