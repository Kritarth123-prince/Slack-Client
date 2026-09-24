import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncConversationsForUser } from "@/lib/slack/sync";
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
    await syncConversationsForUser(userId);
  } catch (err) {
    logger.error("Failed to sync conversations", { message: (err as Error).message });
  }

  const conversations = await prisma.conversation.findMany({
    where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false },
    orderBy: [{ lastMessageAt: "desc" }],
  });

  return NextResponse.json({ conversations });
}
