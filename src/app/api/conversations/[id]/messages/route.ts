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

  // Pull anything newer than what's cached on every call (cheap once caught up, since it only
  // asks Slack for messages after the latest cached one). This is what this polling call relies
  // on to surface new messages even when the Events API webhook isn't reaching this deployment.
  try {
    await syncMessages(userId, conversation);
  } catch (err) {
    logger.error("Failed to sync messages", { message: (err as Error).message });
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

  const [messages, workspaceUsers, savedMessageIds] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { slackTs: "asc" },
      include: { author: true, reactions: true, forwardedFrom: { include: { author: true } } },
    }),
    prisma.slackUser.findMany({ where: { workspaceId: conversation.workspaceId } }),
    prisma.savedMessage.findMany({ where: { userId }, select: { messageId: true } }),
  ]);

  const savedSet = new Set(savedMessageIds.map((s) => s.messageId));
  const userNames = Object.fromEntries(workspaceUsers.map((u) => [u.slackUserId, u.displayName]));

  const responseMessages = messages.map((m) => ({
    id: m.id,
    slackTs: m.slackTs,
    threadTs: m.threadTs,
    text: m.text,
    createdAt: m.createdAt,
    author: m.author ? { displayName: m.author.displayName, avatarUrl: m.author.avatarUrl } : null,
    isSelf: Boolean(self) && m.authorId === self?.id,
    isEdited: m.isEdited,
    isDeleted: m.deletedAt !== null,
    pinned: m.pinned,
    savedByMe: savedSet.has(m.id),
    forwardedFrom: m.forwardedFrom
      ? { authorName: m.forwardedFrom.author?.displayName ?? "Unknown", text: m.forwardedFrom.text }
      : null,
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
