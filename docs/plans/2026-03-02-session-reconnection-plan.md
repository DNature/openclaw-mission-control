# Session Reconnection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to browse and resume unterminated gateway sessions from the chat UI via a session dropdown in the chat header.

**Architecture:** New API route (`/api/chat/history`) calls the gateway's `chat.history` RPC to fetch message history and transforms it to Vercel AI SDK format. The chat header gets a session dropdown (next to the agent selector) that filters existing `/api/sessions` data by the selected agent. Selecting a session fetches history and reconnects the ChatPanel to that session key.

**Tech Stack:** Next.js API routes, React (existing chat-view.tsx), Vercel AI SDK `useChat`, gateway RPC via `gatewayCall`, Lucide icons, Tailwind CSS.

---

### Task 1: Create the chat history API route

**Files:**
- Create: `src/app/api/chat/history/route.ts`

**Step 1: Create the API route**

Create `src/app/api/chat/history/route.ts` with the following code. This wraps the gateway's `chat.history` RPC and transforms messages to AI SDK format.

Reference: The gateway's `chat.history` is already used in `src/app/api/memory/graph/route.ts:965` — we follow the same call pattern and type definitions.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { gatewayCall } from "@/lib/openclaw";

export const dynamic = "force-dynamic";

type GatewayMessageContent = {
  type?: string;
  text?: string;
};

type GatewayMessage = {
  role?: string;
  timestamp?: number;
  content?: GatewayMessageContent[];
};

type ChatHistoryResult = {
  sessionKey?: string;
  messages?: GatewayMessage[];
};

function toEpochMs(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num < 1_000_000_000_000 ? Math.trunc(num * 1000) : Math.trunc(num);
}

function extractText(msg: GatewayMessage): string {
  const chunks = Array.isArray(msg.content) ? msg.content : [];
  return chunks
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => String(c.text))
    .join("\n")
    .trim();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionKey = searchParams.get("sessionKey");
    if (!sessionKey) {
      return NextResponse.json(
        { error: "sessionKey query parameter required" },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Math.max(1, Number(searchParams.get("limit")) || 100),
      500,
    );

    const history = await gatewayCall<ChatHistoryResult>(
      "chat.history",
      { sessionKey, limit },
      10000,
    );

    const raw = Array.isArray(history.messages) ? history.messages : [];

    const messages = raw
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg, i) => {
        const text = extractText(msg);
        if (!text) return null;
        const ts = toEpochMs(msg.timestamp);
        return {
          id: `history-${i}`,
          role: msg.role as "user" | "assistant",
          content: text,
          ...(ts ? { createdAt: new Date(ts).toISOString() } : {}),
        };
      })
      .filter(Boolean);

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("Chat history GET error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

**Step 2: Verify the route compiles**

Run: `npx next build --no-lint 2>&1 | head -30` or a simpler typecheck:
Run: `npx tsc --noEmit src/app/api/chat/history/route.ts 2>&1 | head -20`

If using the project's existing dev server, just confirm no red errors in terminal.

**Step 3: Commit**

```bash
git add src/app/api/chat/history/route.ts
git commit -m "feat: add /api/chat/history route for gateway session message retrieval"
```

---

### Task 2: Add session fetching and state to ChatView

**Files:**
- Modify: `src/components/chat-view.tsx:1269-1430` (ChatView component state and effects)

**Step 1: Add session fetching state and polling**

In the `ChatView` component (line 1269), add state for sessions and a fetch function. Sessions are already available via `/api/sessions` — we just need to fetch and store them.

Add these state variables after `const [now, setNow] = useState(() => Date.now());` (line 1276):

```typescript
const [sessions, setSessions] = useState<
  Array<{
    key: string;
    updatedAt: number;
    ageMs: number;
    totalTokens: number;
    model: string;
  }>
>([]);
```

Add a `fetchSessions` callback after the `fetchAgents` callback (after line 1327):

```typescript
const fetchSessions = useCallback(() => {
  fetch("/api/sessions")
    .then((r) => r.json())
    .then((data) => {
      const list = Array.isArray(data.sessions) ? data.sessions : [];
      setSessions(list);
    })
    .catch(() => {});
}, []);
```

Add a polling effect for sessions (after the agents polling effect, around line 1352). Poll every 10 seconds when visible:

```typescript
useEffect(() => {
  if (isVisible) void fetchSessions();
  const interval = setInterval(() => {
    if (isVisible && document.visibilityState === "visible") {
      void fetchSessions();
    }
  }, 10000);
  return () => clearInterval(interval);
}, [fetchSessions, isVisible]);
```

**Step 2: Pass sessions as a prop to ChatPanel**

In the ChatPanel rendering section (line 1612-1630), filter sessions for the agent and pass them as a prop:

Change the `<ChatPanel>` JSX to include the sessions prop. The filtered sessions should be computed inline or via useMemo. Add this inside the `Array.from(mountedAgents).map(...)` block, just before the `return <ChatPanel ...>`:

```typescript
const agentSessions = sessions.filter((s) =>
  s.key.startsWith(`agent:${agentId}:`)
);
```

Then pass `agentSessions={agentSessions}` to `<ChatPanel>`.

**Step 3: Commit**

```bash
git add src/components/chat-view.tsx
git commit -m "feat: fetch and pass gateway sessions to ChatPanel"
```

---

### Task 3: Add session dropdown and reconnection logic to ChatPanel

**Files:**
- Modify: `src/components/chat-view.tsx:454-478` (ChatPanel props)
- Modify: `src/components/chat-view.tsx:486-489` (ChatPanel state)
- Modify: `src/components/chat-view.tsx:748-1263` (ChatPanel JSX)

This is the main UI task. We add:
1. A new prop `agentSessions` on ChatPanel
2. Session dropdown state + click-outside handler
3. A `resumeSession` function that fetches history and switches session key
4. The dropdown JSX in the chat panel header area

**Step 1: Add the `agentSessions` prop to ChatPanel**

Update the ChatPanel function signature (line 454-478) to accept the new prop:

Add to the props type:
```typescript
agentSessions: Array<{
  key: string;
  updatedAt: number;
  ageMs: number;
  totalTokens: number;
  model: string;
}>;
```

**Step 2: Add session dropdown state**

After the existing state declarations in ChatPanel (around line 500), add:

```typescript
const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
const [sessionLoading, setSessionLoading] = useState(false);
const sessionDropdownRef = useRef<HTMLDivElement>(null);
```

Add a click-outside handler (similar to the model menu one at line 603-612):

```typescript
useEffect(() => {
  if (!sessionDropdownOpen) return;
  const handleClick = (e: MouseEvent) => {
    if (
      sessionDropdownRef.current &&
      !sessionDropdownRef.current.contains(e.target as Node)
    ) {
      setSessionDropdownOpen(false);
    }
  };
  document.addEventListener("mousedown", handleClick);
  return () => document.removeEventListener("mousedown", handleClick);
}, [sessionDropdownOpen]);
```

**Step 3: Add the `resumeSession` function**

Add this after the `clearChat` function (line 726):

```typescript
const resumeSession = useCallback(
  async (sessionKey: string) => {
    setSessionLoading(true);
    setSessionDropdownOpen(false);
    try {
      const res = await fetch(
        `/api/chat/history?sessionKey=${encodeURIComponent(sessionKey)}&limit=100`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      setMessages(
        msgs.map((m: { id: string; role: string; content: string; createdAt?: string }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts: [{ type: "text" as const, text: m.content }],
          ...(m.createdAt ? { createdAt: new Date(m.createdAt) } : {}),
        })),
      );
      setChatSessionKey(sessionKey);
      prevMsgCountRef.current = msgs.length;
    } catch (err) {
      console.error("Failed to load session history:", err);
      // Stay on current session — don't change state
    } finally {
      setSessionLoading(false);
    }
  },
  [setMessages],
);
```

**Step 4: Add the session dropdown JSX**

Add the `History` (lucide-react) import at the top of the file alongside existing lucide imports (line 14-31):

```typescript
import { History } from "lucide-react";
```

In the ChatPanel JSX, add the session dropdown. The best location is in the chat panel's own internal header area. Look for the input area / toolbar section at the top of the chat messages area.

Since ChatPanel currently has no header of its own (the header is in ChatView), we need to add a small toolbar row inside the ChatPanel, just above the messages area. Place it right after the opening `<div>` of the chat panel's content area (line 748-753). Add a thin toolbar row:

```tsx
{/* Session selector toolbar */}
{agentSessions.length > 0 && (
  <div className="flex items-center gap-2 border-b border-foreground/5 px-4 py-1.5">
    <div className="relative" ref={sessionDropdownRef}>
      <button
        type="button"
        onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
        disabled={isLoading}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          isLoading && "pointer-events-none opacity-50"
        )}
      >
        <History className="h-3 w-3" />
        <span>
          {chatSessionKey.startsWith(`agent:${agentId}:`)
            ? formatRelativeTime(
                agentSessions.find((s) => s.key === chatSessionKey)?.ageMs
              ) || "Current session"
            : "New session"}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {sessionDropdownOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-56 overflow-hidden rounded-lg border border-foreground/10 bg-card/95 py-1 shadow-xl backdrop-blur-sm">
          {/* New Chat option */}
          <button
            type="button"
            onClick={() => {
              clearChat();
              setSessionDropdownOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="text-emerald-400">+</span>
            <span>New Chat</span>
          </button>

          <div className="my-1 border-t border-foreground/5" />

          {/* Session list */}
          {agentSessions.map((session) => (
            <button
              key={session.key}
              type="button"
              onClick={() => resumeSession(session.key)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors",
                session.key === chatSessionKey
                  ? "bg-violet-500/10 text-violet-300"
                  : "text-foreground/70 hover:bg-muted hover:text-foreground"
              )}
            >
              {session.key === chatSessionKey && (
                <Circle className="h-1.5 w-1.5 flex-shrink-0 fill-violet-400 text-violet-400" />
              )}
              <span className={session.key !== chatSessionKey ? "ml-3.5" : ""}>
                {formatRelativeTime(session.ageMs)}
              </span>
              <span className="text-muted-foreground">
                &bull; {formatTokenCount(session.totalTokens)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>

    {sessionLoading && (
      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
    )}
  </div>
)}
```

**Step 5: Add helper functions**

Add these helper functions near the top of the file (after `formatModel` at line 75-78):

```typescript
function formatRelativeTime(ageMs: number | undefined | null): string {
  if (ageMs == null || ageMs < 0) return "just now";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens} tokens`;
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${Math.round(tokens / 1000)}k tokens`;
}
```

**Step 6: Commit**

```bash
git add src/components/chat-view.tsx
git commit -m "feat: add session dropdown and reconnection to ChatPanel"
```

---

### Task 4: Manual testing and polish

**Files:**
- Modify: `src/components/chat-view.tsx` (if adjustments needed)

**Step 1: Start the dev server and test**

Run: `npm run dev` (or whatever the project uses)

Test the following scenarios:
1. Open the chat — verify the session dropdown appears when there are gateway sessions
2. Send a few messages to create a session
3. Click "New Chat" — verify messages clear and a new session key is created
4. Open the session dropdown — verify the previous session appears with time and token count
5. Click the previous session — verify messages load from gateway history
6. Send a new message after resuming — verify it continues in the same gateway session
7. Verify the dropdown is disabled during streaming
8. Verify the loading spinner shows while fetching history

**Step 2: Edge case testing**

1. Test with no sessions (new agent) — dropdown should not render
2. Test with gateway unavailable — should not break the UI
3. Test agent switching — sessions should filter correctly per agent
4. Refresh the page — sessions should still be listed from the gateway

**Step 3: Fix any issues found during testing and commit**

```bash
git add -u
git commit -m "fix: polish session reconnection after manual testing"
```

---

### Task 5: Final review and cleanup

**Step 1: Review all changes**

Run: `git diff main --stat` to see all files changed.
Run: `git diff main` to review the full diff.

Check for:
- No console.log debugging left in
- No unused imports
- Consistent styling with existing code
- No TypeScript errors: `npx tsc --noEmit 2>&1 | head -30`

**Step 2: Commit any cleanup**

```bash
git add -u
git commit -m "chore: clean up session reconnection implementation"
```
