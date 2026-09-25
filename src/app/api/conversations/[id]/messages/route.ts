import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncMessages, postMessage, markConversationRead } from "@/lib/slack/sync";
import { extractSlackFiles } from "@/lib/slack/messageFiles";
import { groupReactions } from "@/lib/slack/reactionGroups";
import { logger } from "@/lib/logger";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Only pull history from Slack the first time — after that the events webhook (and our own
  // sends) keep the DB current, so this refresh call (used after posting, and on manual reload)
  // renders instantly from the DB instead of re-fetching from Slack every time.
  const hasCachedMessages = (await prisma.message.count({ where: { conversationId: conversation.id } })) > 0;
  if (!hasCachedMessages) {
    try {
      await syncMessages(userId, conversation);
    } catch (err) {
      logger.error("Failed to sync messages", { message: (err as Error).message });
    }
  }

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  const self = installation
    ? await prisma.slackUser.findUnique({
        where: {
          workspaceId_slackUserId: { workspaceId: conversation.workspaceId, slackUserId: installation.slackUserId },
        },
      })
    : null;

  const [messages, workspaceUsers] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      orderBy: { slackTs: "asc" },
      include: { author: true, reactions: true },
    }),
    prisma.slackUser.findMany({ where: { workspaceId: conversation.workspaceId } }),
  ]);

  const userNames = Object.fromEntries(workspaceUsers.map((u) => [u.slackUserId, u.displayName]));

  const responseMessages = messages.map((m) => ({
    id: m.id,
    text: m.text,
    createdAt: m.createdAt,
    author: m.author ? { displayName: m.author.displayName, avatarUrl: m.author.avatarUrl } : null,
    isSelf: Boolean(self) && m.authorId === self?.id,
    files: extractSlackFiles(m.raw),
    reactions: groupReactions(m.reactions, self?.id),
  }));

  const lastTs = messages[messages.length - 1]?.slackTs;
  if (lastTs) await markConversationRead(userId, conversation.id, lastTs).catch(() => {});

  return NextResponse.json({ messages: responseMessages, userNames });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; threadTs?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  const threadTs = typeof body?.threadTs === "string" ? body.threadTs : undefined;

  try {
    await postMessage(userId, conversation, text, threadTs);
  } catch (err) {
    logger.error("Failed to send Slack message", { message: (err as Error).message });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
