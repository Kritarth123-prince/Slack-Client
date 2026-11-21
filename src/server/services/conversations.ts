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
 * The conversation list with real unread counts. A conversation is "unread" when it has root
 * messages past the user's read cursor that someone else sent — your own messages (say, sent from
 * Slack's phone app) never make a conversation unread. The count is how many of those arrived
 * (capped by what's cached locally, which is all the UI can show anyway). When nothing past the
 * cursor is cached yet, Slack's latest-message marker decides. Pinned conversations come first,
 * in their usual recency order.
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

  const pastCursor = (c: (typeof conversations)[number]) => {
    const lastRead = readMap.get(c.id);
    return Boolean(c.lastMessageTs) && (!lastRead || lastRead < c.lastMessageTs!);
  };
  const candidates = conversations.filter(pastCursor);

  // Only root messages count — thread replies don't make a channel unread in Slack either. The
  // root/reply distinction is a column comparison Prisma can't express, so the (small) set of
  // messages past each cursor is fetched and counted here.
  const newer =
    candidates.length === 0
      ? []
      : await prisma.message.findMany({
          where: {
            OR: candidates.map((c) => {
              const lastRead = readMap.get(c.id);
              return { conversationId: c.id, ...(lastRead ? { slackTs: { gt: lastRead } } : {}) };
            }),
          },
          select: { conversationId: true, slackTs: true, threadTs: true, authorId: true, deletedAt: true },
        });
  const fromOthers = new Map<string, number>();
  const cached = new Map<string, number>();
  for (const m of newer) {
    if (m.threadTs && m.threadTs !== m.slackTs) continue;
    cached.set(m.conversationId, (cached.get(m.conversationId) ?? 0) + 1);
    if (m.deletedAt || (self && m.authorId === self.id)) continue;
    fromOthers.set(m.conversationId, (fromOthers.get(m.conversationId) ?? 0) + 1);
  }

  const items = conversations.map((c) => {
    const count = fromOthers.get(c.id) ?? 0;
    const unread = pastCursor(c) && (count > 0 || !cached.has(c.id));
    const setting = settingMap.get(c.id);
    return {
      id: c.id,
      label: conversationLabel(c, installation.slackUserId),
      unread,
      unreadCount: unread ? count : 0,
      pinned: setting?.pinned ?? false,
      muted: setting?.muted ?? false,
      type: c.type,
      avatarUrl: conversationAvatarUrl(c, installation.slackUserId),
    };
  });

  return [...items.filter((i) => i.pinned), ...items.filter((i) => !i.pinned)];
}

const DIRECTORY_REFRESH_INTERVAL_MS = 2 * 60_000;
const lastDirectoryRefresh = new Map<string, number>();

/**
 * The full refresh behind the conversation list page: workspace members, conversations, workspace
 * branding and Slack's read cursors. Wrapped in React's cache() so it runs once per request.
 */
export const syncWorkspace = cache(async (userId: string): Promise<void> => {
  await Promise.all([
    syncConversationsForUser(userId).catch((err) =>
      logger.error("Failed to sync conversations", { message: (err as Error).message })
    ),
    syncWorkspaceBranding(userId),
  ]);
  lastDirectoryRefresh.set(userId, Date.now());
  const installation = await getActiveInstallation(userId);
  if (installation) {
    await syncReadCursorsFromSlack(userId, installation).catch((err) =>
      logger.warn("Failed to sync read cursors from Slack", { message: (err as Error).message })
    );
  }
});

/** Whether anything has been synced for the user's active workspace yet (false straight after connecting it). */
export async function hasCachedConversations(userId: string): Promise<boolean> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return false;
  const count = await prisma.conversation.count({ where: { workspaceId: installation.workspaceId, isMember: true } });
  return count > 0;
}

/**
 * Picks up conversations that didn't exist at the last full load — a first DM from someone, a
 * channel you were just added to — without waiting for a visit to the conversation list page.
 * Run in the background of the list poll at most every couple of minutes per user (per server
 * instance; an extra run elsewhere only costs a conversations.list call), and skips the
 * workspace-directory sweep, which the page load already does.
 */
export async function refreshConversationDirectory(userId: string): Promise<void> {
  const last = lastDirectoryRefresh.get(userId) ?? 0;
  if (Date.now() - last < DIRECTORY_REFRESH_INTERVAL_MS) return;
  lastDirectoryRefresh.set(userId, Date.now());
  await syncConversationsForUser(userId, { includeUsers: false }).catch((err) =>
    logger.warn("Failed to refresh the conversation directory", { message: (err as Error).message })
  );
}
