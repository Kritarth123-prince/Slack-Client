import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { conversationLabel } from "@/lib/slack/conversationLabel";
import { logger } from "@/lib/logger";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const installation = await prisma.slackInstallation.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { installedAt: "desc" },
    });

    const saved = await prisma.savedMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        message: {
          include: {
            author: true,
            conversation: { include: { members: { include: { slackUser: true } } } },
          },
        },
      },
    });

    const result = saved
      .filter((s) => s.message)
      .map((s) => ({
        id: s.id,
        savedAt: s.createdAt,
        message: {
          id: s.message.id,
          text: s.message.text,
          createdAt: s.message.createdAt,
          authorName: s.message.author?.displayName ?? "Unknown",
          isDeleted: s.message.deletedAt !== null,
        },
        conversation: {
          id: s.message.conversation.id,
          label: installation ? conversationLabel(s.message.conversation, installation.slackUserId) : (s.message.conversation.name ?? "Conversation"),
        },
      }));

    return NextResponse.json({ saved: result });
  } catch (err) {
    logger.error("Failed to list saved messages", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
