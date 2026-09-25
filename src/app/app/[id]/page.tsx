import { redirect, notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncMessages, markConversationRead } from "@/lib/slack/sync";
import { conversationLabel } from "@/lib/slack/conversationLabel";
import { extractSlackFiles } from "@/lib/slack/messageFiles";
import { groupReactions } from "@/lib/slack/reactionGroups";
import { ConversationThread } from "./ConversationThread";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { members: { include: { slackUser: true } } },
  });
  if (!conversation) notFound();

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) redirect("/");

  // Only pull history from Slack the first time we open a conversation — after that the events
  // webhook (and our own sends) keep the DB current, so repeat visits render instantly from it.
  const hasCachedMessages = (await prisma.message.count({ where: { conversationId: conversation.id } })) > 0;
  if (!hasCachedMessages) {
    await syncMessages(userId, conversation).catch(() => {});
  }

  const self = await prisma.slackUser.findUnique({
    where: {
      workspaceId_slackUserId: { workspaceId: conversation.workspaceId, slackUserId: installation.slackUserId },
    },
  });

  const [messages, workspaceUsers] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      orderBy: { slackTs: "asc" },
      include: { author: true, reactions: true },
    }),
    prisma.slackUser.findMany({ where: { workspaceId: conversation.workspaceId } }),
  ]);

  const userNames = Object.fromEntries(workspaceUsers.map((u) => [u.slackUserId, u.displayName]));

  const lastTs = messages[messages.length - 1]?.slackTs;
  if (lastTs) await markConversationRead(userId, conversation.id, lastTs).catch(() => {});

  return (
    <ConversationThread
      conversationId={conversation.id}
      title={conversationLabel(conversation, installation.slackUserId)}
      initialMessages={messages.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        authorName: m.author?.displayName ?? "Unknown",
        authorAvatarUrl: m.author?.avatarUrl ?? null,
        isSelf: Boolean(self) && m.authorId === self?.id,
        files: extractSlackFiles(m.raw),
        reactions: groupReactions(m.reactions, self?.id),
      }))}
      initialUserNames={userNames}
    />
  );
}
