import type { Conversation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getInstallationForWorkspace } from "@/lib/slack/installation";
import { extractSlackFiles } from "@/lib/slack/messageFiles";
import { groupReactions } from "@/lib/slack/reactionGroups";
import { mentionedUserIds, newestRootTs } from "@/lib/slack/syncHelpers";
import type { MessageView } from "@/types/chat";

// The feed shows at most this many root messages (plus their replies). The open conversation is
// re-read every few seconds, so returning a busy channel's entire cached history on each poll grew
// without bound.
const FEED_ROOT_LIMIT = 200;

export interface ConversationMessages {
  messages: MessageView[];
  /** Slack user id → display name, for every `<@U…>` mention in these messages. */
  userNames: Record<string, string>;
  /** The newest root message's ts — where the read cursor goes when the conversation is viewed. */
  newestRootTs: string | null;
  clearedBeforeTs: string | null;
}

/** Bots and integrations have no SlackUser row; their payload still names them. */
function payloadAuthorName(raw: unknown): string | null {
  const r = raw as {
    user_profile?: { display_name?: string; real_name?: string };
    bot_profile?: { name?: string };
    username?: string;
  } | null;
  return r?.user_profile?.display_name || r?.user_profile?.real_name || r?.bot_profile?.name || r?.username || null;
}

/**
 * Everything the conversation view renders, shared by the page's first render and the polling
 * route: the newest roots and their replies, minus anything this user cleared, resolved against the
 * user's own identity in *this conversation's* workspace (which may not be the one they're viewing).
 */
export async function loadConversationMessages(userId: string, conversation: Conversation): Promise<ConversationMessages> {
  const [installation, setting] = await Promise.all([
    getInstallationForWorkspace(userId, conversation.workspaceId),
    prisma.conversationSetting.findUnique({
      where: { userId_conversationId: { userId, conversationId: conversation.id } },
      select: { clearedBeforeTs: true },
    }),
  ]);
  const clearedBeforeTs = setting?.clearedBeforeTs ?? null;

  const [self, roots] = await Promise.all([
    installation
      ? prisma.slackUser.findUnique({
          where: {
            workspaceId_slackUserId: { workspaceId: conversation.workspaceId, slackUserId: installation.slackUserId },
          },
        })
      : null,
    // Root-vs-reply is a column comparison Prisma's query builder can't express.
    prisma.$queryRaw<{ slackTs: string }[]>`
      SELECT "slackTs" FROM "Message"
      WHERE "conversationId" = ${conversation.id}
        AND ("threadTs" IS NULL OR "threadTs" = "slackTs")
        AND "slackTs" > ${clearedBeforeTs ?? ""}
      ORDER BY "slackTs" DESC
      LIMIT ${FEED_ROOT_LIMIT}
    `,
  ]);

  const rootTs = roots.map((r) => r.slackTs);
  if (rootTs.length === 0) return { messages: [], userNames: {}, newestRootTs: null, clearedBeforeTs };

  const [rows, saved] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, OR: [{ slackTs: { in: rootTs } }, { threadTs: { in: rootTs } }] },
      orderBy: { slackTs: "asc" },
      include: { author: true, reactions: true, forwardedFrom: { include: { author: true } } },
    }),
    prisma.savedMessage.findMany({
      where: { userId, message: { conversationId: conversation.id } },
      select: { messageId: true },
    }),
  ]);

  const mentioned = new Set<string>();
  for (const m of rows) {
    for (const id of mentionedUserIds(m.text)) mentioned.add(id);
    if (m.forwardedFrom) for (const id of mentionedUserIds(m.forwardedFrom.text)) mentioned.add(id);
  }
  const mentionedUsers =
    mentioned.size === 0
      ? []
      : await prisma.slackUser.findMany({
          where: { workspaceId: conversation.workspaceId, slackUserId: { in: [...mentioned] } },
          select: { slackUserId: true, displayName: true },
        });

  const savedSet = new Set(saved.map((s) => s.messageId));
  const messages: MessageView[] = rows.map((m) => ({
    id: m.id,
    slackTs: m.slackTs,
    threadTs: m.threadTs,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
    authorId: m.authorId,
    authorName: m.author?.displayName ?? payloadAuthorName(m.raw) ?? "Unknown",
    authorAvatarUrl: m.author?.avatarUrl ?? null,
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

  return {
    messages,
    userNames: Object.fromEntries(mentionedUsers.map((u) => [u.slackUserId, u.displayName])),
    newestRootTs: newestRootTs(rows),
    clearedBeforeTs,
  };
}
