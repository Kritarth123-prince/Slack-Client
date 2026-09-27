import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncAllConversationsAndNotify } from "@/lib/slack/sync";
import { getConversationListItems } from "@/server/services/conversations";
import { logger } from "@/lib/logger";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  // Catches up every conversation (and pushes a notification for new messages) so unread
  // highlighting and notifications work even when the Events API webhook isn't reaching this
  // deployment — see syncAllConversationsAndNotify.
  await syncAllConversationsAndNotify(userId).catch((err) =>
    logger.error("Failed to sync conversations for list refresh", { message: (err as Error).message })
  );

  try {
    return NextResponse.json({ conversations: await getConversationListItems(userId) });
  } catch (err) {
    logger.error("Failed to list conversations", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
