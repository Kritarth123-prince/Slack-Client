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

  const lastTs = messages[messages.length - 1]?.slackTs;
  if (lastTs) await markConversationRead(userId, conversation.id, lastTs).catch(() => {});

  return (
    <ConversationThread
      conversationId={conversation.id}
      title={conversationLabel(conversation, installation.slackUserId)}
      initialMessages={messages.map((m) => ({
        id: m.id,
        slackTs: m.slackTs,
        threadTs: m.threadTs,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        authorName: m.author?.displayName ?? "Unknown",
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
      }))}
      initialUserNames={userNames}
    />
  );
}
