import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import { conversationLabel, conversationAvatarUrl } from "@/lib/slack/conversationLabel";
import { getActiveInstallation } from "@/lib/slack/installation";
import { syncConversationsForUser, syncReadCursorsFromSlack } from "@/lib/slack/sync";
import { syncWorkspaceBranding } from "@/server/services/workspace";
import { logger } from "@/lib/logger";

export interface ConversationListItem {
  id: string;
  label: string;
  unread: boolean;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  type: "PUBLIC_CHANNEL" | "PRIVATE_CHANNEL" | "DM" | "GROUP_DM";
  avatarUrl: string | null;
}

/**
 * The conversation list with real unread counts. A conversation is "unread" when its latest
 * message is past the user's read cursor; the count is how many messages from other people have
 * arrived since that cursor (capped by what's cached locally, which is all the UI can show anyway).
 * Pinned conversations come first, in their usual recency order.
 */
export async function getConversationListItems(userId: string): Promise<ConversationListItem[]> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return [];

  const [conversations, readStates, settings, self] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      include: { members: { include: { slackUser: true } } },
    }),
    prisma.readState.findMany({ where: { userId } }),
    prisma.conversationSetting.findMany({ where: { userId } }),
    prisma.slackUser.findUnique({
      where: {
        workspaceId_slackUserId: { workspaceId: installation.workspaceId, slackUserId: installation.slackUserId },
      },
    }),
  ]);

  const readMap = new Map(readStates.map((r) => [r.conversationId, r.lastReadTs]));
  const settingMap = new Map(settings.map((s) => [s.conversationId, s]));

  const unreadConversations = conversations.filter((c) => {
    const lastRead = readMap.get(c.id);
    return Boolean(c.lastMessageTs) && (!lastRead || lastRead < c.lastMessageTs!);
  });

  // Only root messages count — thread replies don't make a channel unread in Slack either. The
  // root/reply distinction is a column comparison Prisma can't express, so the (small) set of
  // messages past each cursor is fetched and counted here.
  const newer =
    unreadConversations.length === 0
      ? []
      : await prisma.message.findMany({
          where: {
            deletedAt: null,
            ...(self ? { NOT: { authorId: self.id } } : {}),
            OR: unreadConversations.map((c) => {
              const lastRead = readMap.get(c.id);
              return { conversationId: c.id, ...(lastRead ? { slackTs: { gt: lastRead } } : {}) };
            }),
          },
          select: { conversationId: true, slackTs: true, threadTs: true },
        });
  const countMap = new Map<string, number>();
  for (const m of newer) {
    if (m.threadTs && m.threadTs !== m.slackTs) continue;
    countMap.set(m.conversationId, (countMap.get(m.conversationId) ?? 0) + 1);
  }

  const items = conversations.map((c) => {
    const lastRead = readMap.get(c.id);
    const unread = Boolean(c.lastMessageTs) && (!lastRead || lastRead < c.lastMessageTs!);
    const setting = settingMap.get(c.id);
    return {
      id: c.id,
      label: conversationLabel(c, installation.slackUserId),
      unread,
      unreadCount: unread ? (countMap.get(c.id) ?? 0) : 0,
      pinned: setting?.pinned ?? false,
      muted: setting?.muted ?? false,
      type: c.type,
      avatarUrl: conversationAvatarUrl(c, installation.slackUserId),
    };
  });

  return [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned)];
}

/**
 * Syncs from Slack, then builds the list. Wrapped in React's cache() so the app layout (sidebar)
 * and a page rendered inside it share one sync + one query per request instead of each doing
 * their own — the sync is the expensive part.
 */
export const loadConversationList = cache(async (userId: string): Promise<ConversationListItem[]> => {
  await Promise.all([
    syncConversationsForUser(userId).catch((err) =>
      logger.error("Failed to sync conversations", { message: (err as Error).message })
    ),
    syncWorkspaceBranding(userId),
  ]);
  const installation = await getActiveInstallation(userId);
  if (installation) {
    await syncReadCursorsFromSlack(userId, installation).catch((err) =>
      logger.warn("Failed to sync read cursors from Slack", { message: (err as Error).message })
    );
  }
  return getConversationListItems(userId);
});
