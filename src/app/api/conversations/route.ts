import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { conversationLabel, conversationAvatarUrl } from "@/lib/slack/conversationLabel";
import { logger } from "@/lib/logger";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  try {
    const conversations = await prisma.conversation.findMany({
      where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      include: { members: { include: { slackUser: true } } },
    });

    const readStates = await prisma.readState.findMany({
      where: { userId, conversationId: { in: conversations.map((c) => c.id) } },
    });
    const readMap = new Map(readStates.map((r) => [r.conversationId, r.lastReadTs]));

    const result = conversations.map((c) => {
      const lastRead = readMap.get(c.id);
      const unread = Boolean(c.lastMessageTs) && (!lastRead || lastRead < c.lastMessageTs!);
      return {
        id: c.id,
        label: conversationLabel(c, installation.slackUserId),
        unread,
        type: c.type,
        avatarUrl: conversationAvatarUrl(c, installation.slackUserId),
      };
    });

    return NextResponse.json({ conversations: result });
  } catch (err) {
    logger.error("Failed to list conversations", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
