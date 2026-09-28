import { prisma } from "@/lib/db/prisma";
import { getSlackClientForUser } from "@/lib/slack/client";
import { conversationLabel } from "@/lib/slack/conversationLabel";
import { getActiveInstallation } from "@/lib/slack/installation";

export interface SearchResultView {
  id: string;
  text: string;
  ts: string;
  createdAt: string;
  authorName: string;
  conversationId: string | null;
  conversationLabel: string;
  messageId: string | null;
  permalink: string | null;
}

export interface SearchOutcome {
  results: SearchResultView[];
  total: number;
  error: "missing_scope" | "failed" | null;
}

const RESULT_COUNT = 30;

/** Runs Slack's own search.messages and maps matches back onto locally cached conversations/messages so results can deep-link into the app. */
export async function searchMessages(userId: string, query: string): Promise<SearchOutcome> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return { results: [], total: 0, error: "failed" };

  let matches;
  let total = 0;
  try {
    const client = await getSlackClientForUser(userId);
    const res = await client.search.messages({ query, count: RESULT_COUNT, sort: "timestamp", sort_dir: "desc" });
    matches = res.messages?.matches ?? [];
    total = res.messages?.total ?? matches.length;
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    return { results: [], total: 0, error: code === "missing_scope" ? "missing_scope" : "failed" };
  }

  const channelIds = [...new Set(matches.map((m) => m.channel?.id).filter((id): id is string => Boolean(id)))];
  const userIds = [...new Set(matches.map((m) => m.user).filter((id): id is string => Boolean(id)))];

  const [conversations, users] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId: installation.workspaceId, slackConversationId: { in: channelIds } },
      include: { members: { include: { slackUser: true } } },
    }),
    prisma.slackUser.findMany({ where: { workspaceId: installation.workspaceId, slackUserId: { in: userIds } } }),
  ]);
  const conversationBySlackId = new Map(conversations.map((c) => [c.slackConversationId, c]));
  const userBySlackId = new Map(users.map((u) => [u.slackUserId, u]));

  const localMessages = await prisma.message.findMany({
    where: {
      OR: matches
        .filter((m) => m.ts && m.channel?.id && conversationBySlackId.has(m.channel.id))
        .map((m) => ({ conversationId: conversationBySlackId.get(m.channel!.id!)!.id, slackTs: m.ts! })),
    },
    select: { id: true, conversationId: true, slackTs: true },
  });
  const localMessageKey = (conversationId: string, ts: string) => `${conversationId}:${ts}`;
  const localMessageIds = new Map(localMessages.map((m) => [localMessageKey(m.conversationId, m.slackTs), m.id]));

  const results: SearchResultView[] = matches
    .filter((m) => m.ts && m.text)
    .map((m) => {
      const conversation = m.channel?.id ? conversationBySlackId.get(m.channel.id) : undefined;
      const author = m.user ? userBySlackId.get(m.user) : undefined;
      return {
        id: m.iid ?? `${m.channel?.id ?? "?"}:${m.ts}`,
        text: m.text ?? "",
        ts: m.ts!,
        createdAt: new Date(Number(m.ts!.split(".")[0]) * 1000).toISOString(),
        authorName: author?.displayName ?? m.username ?? "Unknown",
        conversationId: conversation?.id ?? null,
        conversationLabel: conversation
          ? conversationLabel(conversation, installation.slackUserId)
          : m.channel?.name
            ? `#${m.channel.name}`
            : "Conversation",
        messageId: conversation ? (localMessageIds.get(localMessageKey(conversation.id, m.ts!)) ?? null) : null,
        permalink: m.permalink ?? null,
      };
    });

  return { results, total, error: null };
}
