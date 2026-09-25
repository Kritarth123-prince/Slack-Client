import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { forwardMessage } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, messageId } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const message = await prisma.message.findFirst({ where: { id: messageId, conversationId: conversation.id } });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { targetConversationId?: unknown } | null;
  const targetConversationId = typeof body?.targetConversationId === "string" ? body.targetConversationId : "";
  if (!targetConversationId) return NextResponse.json({ error: "missing_target" }, { status: 400 });

  const target = await prisma.conversation.findFirst({
    where: { id: targetConversationId, workspaceId: conversation.workspaceId },
  });
  if (!target) return NextResponse.json({ error: "target_not_found" }, { status: 404 });

  try {
    await forwardMessage(userId, target, message);
  } catch (err) {
    logger.error("Failed to forward message", { message: (err as Error).message });
    return NextResponse.json({ error: "forward_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
