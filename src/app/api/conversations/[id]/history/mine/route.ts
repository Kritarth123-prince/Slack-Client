import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getAccessibleConversation } from "@/server/services/access";
import { deleteOwnMessagesBatch } from "@/server/services/conversationHistory";
import { logger } from "@/lib/logger";

/**
 * Deletes one batch of the user's own messages from Slack in a DM or group DM. The client keeps
 * calling with the returned `before` until `done`, which keeps each request short.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await getAccessibleConversation(userId, id);
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (conversation.type !== "DM" && conversation.type !== "GROUP_DM") {
    return NextResponse.json({ error: "direct_messages_only" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { before?: unknown } | null;
  const before = typeof body?.before === "string" && /^\d+\.\d+$/.test(body.before) ? body.before : null;

  try {
    return NextResponse.json(await deleteOwnMessagesBatch(userId, conversation, before));
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    logger.error("Failed to delete own messages", { code, message: (err as Error).message });
    return NextResponse.json({ error: code === "missing_scope" ? "missing_scope" : "failed" }, { status: 502 });
  }
}

export const maxDuration = 60;
