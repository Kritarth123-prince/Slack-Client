import { prisma } from "@/lib/db/prisma";

// Typing indicators and read receipts are both app-local: Slack's Web API exposes neither
// (typing is an RTM/Socket Mode event; per-user read state is never shared). So they reflect
// what people using *this* client are doing, and nothing about Slack's own clients.

const TYPING_TTL_MS = 8000;
const TYPING_PURGE_AFTER_MS = 60_000;

export interface TypingView {
  threadTs: string;
  name: string;
}

export interface ReaderView {
  slackUserId: string;
  name: string;
  avatarUrl: string | null;
  lastReadTs: string;
}

async function selfForConversation(userId: string, workspaceId: string) {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null, workspaceId },
  });
  if (!installation) return null;
  return prisma.slackUser.findUnique({
    where: { workspaceId_slackUserId: { workspaceId, slackUserId: installation.slackUserId } },
  });
}

/** Records that the user is typing in a conversation (or one of its threads) right now. */
export async function recordTyping(
  userId: string,
  conversation: { id: string; workspaceId: string },
  threadTs: string
): Promise<void> {
  const self = await selfForConversation(userId, conversation.workspaceId);
  if (!self) return;

  const now = new Date();
  await prisma.typingIndicator.upsert({
    where: { conversationId_threadTs_slackUserId: { conversationId: conversation.id, threadTs, slackUserId: self.id } },
    update: { updatedAt: now },
    create: { conversationId: conversation.id, threadTs, slackUserId: self.id, updatedAt: now },
  });

  // Opportunistic cleanup so the table stays tiny without a scheduled job.
  await prisma.typingIndicator.deleteMany({
    where: { conversationId: conversation.id, updatedAt: { lt: new Date(Date.now() - TYPING_PURGE_AFTER_MS) } },
  });
}

/** Clears the user's typing state (called when a message is sent). */
export async function clearTyping(userId: string, conversation: { id: string; workspaceId: string }, threadTs: string): Promise<void> {
  const self = await selfForConversation(userId, conversation.workspaceId);
  if (!self) return;
  await prisma.typingIndicator.deleteMany({ where: { conversationId: conversation.id, threadTs, slackUserId: self.id } });
}

/** Everyone (other than the requesting user) who has typed in this conversation within the last few seconds. */
export async function listTyping(conversationId: string, selfSlackUserRowId: string | undefined): Promise<TypingView[]> {
  const rows = await prisma.typingIndicator.findMany({
    where: {
      conversationId,
      updatedAt: { gte: new Date(Date.now() - TYPING_TTL_MS) },
      ...(selfSlackUserRowId ? { NOT: { slackUserId: selfSlackUserRowId } } : {}),
    },
    include: { slackUser: true },
  });
  return rows.map((r) => ({ threadTs: r.threadTs, name: r.slackUser.displayName }));
}

/**
 * Other people using this app who have a read cursor in the conversation. A message counts as
 * "seen" by someone when their lastReadTs is at or past that message's ts — which only ever
 * advances while they have the conversation open in a visible tab.
 */
export async function listReaders(
  conversation: { id: string; workspaceId: string },
  selfUserId: string
): Promise<ReaderView[]> {
  const states = await prisma.readState.findMany({
    where: { conversationId: conversation.id, NOT: { userId: selfUserId } },
    include: {
      user: { include: { installations: { where: { workspaceId: conversation.workspaceId, revokedAt: null }, take: 1 } } },
    },
  });
  if (states.length === 0) return [];

  const slackUserIds = states
    .map((s) => s.user.installations[0]?.slackUserId)
    .filter((id): id is string => Boolean(id));
  const users = await prisma.slackUser.findMany({
    where: { workspaceId: conversation.workspaceId, slackUserId: { in: slackUserIds } },
  });
  const bySlackId = new Map(users.map((u) => [u.slackUserId, u]));

  return states.flatMap((s) => {
    const slackUserId = s.user.installations[0]?.slackUserId;
    const user = slackUserId ? bySlackId.get(slackUserId) : undefined;
    if (!slackUserId || !user) return [];
    return [{ slackUserId, name: user.displayName, avatarUrl: user.avatarUrl, lastReadTs: s.lastReadTs }];
  });
}
