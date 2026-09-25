import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { addReaction, removeReaction } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, messageId } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const message = await prisma.message.findFirst({ where: { id: messageId, conversationId: conversation.id } });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { emoji?: unknown } | null;
  const emoji = typeof body?.emoji === "string" ? body.emoji : "";
  if (!emoji) return NextResponse.json({ error: "missing_emoji" }, { status: 400 });

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const self = await prisma.slackUser.findUnique({
    where: { workspaceId_slackUserId: { workspaceId: conversation.workspaceId, slackUserId: installation.slackUserId } },
  });
  const alreadyReacted = self
    ? await prisma.reaction.findUnique({
        where: { messageId_emoji_slackUserId: { messageId: message.id, emoji, slackUserId: self.id } },
      })
    : null;

  try {
    if (alreadyReacted) {
      await removeReaction(userId, conversation, message, emoji);
    } else {
      await addReaction(userId, conversation, message, emoji);
    }
  } catch (err) {
    logger.error("Failed to toggle reaction", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
