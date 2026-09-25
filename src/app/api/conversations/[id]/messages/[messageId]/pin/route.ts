import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { setMessagePinned } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, messageId } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const message = await prisma.message.findFirst({ where: { id: messageId, conversationId: conversation.id } });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
  const pinned = typeof body?.pinned === "boolean" ? body.pinned : !message.pinned;

  try {
    await setMessagePinned(userId, conversation, message, pinned);
  } catch (err) {
    logger.error("Failed to toggle pin", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, pinned });
}
