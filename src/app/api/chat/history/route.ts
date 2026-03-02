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
