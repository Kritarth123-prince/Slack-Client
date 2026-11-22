import { redirect, notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncMessages, markConversationRead } from "@/lib/slack/sync";
import { conversationAvatarUrl, conversationLabel } from "@/lib/slack/conversationLabel";
import { getInstallationForWorkspace } from "@/lib/slack/installation";
import { listReaders } from "@/server/services/presenceSignals";
import { getConversationSetting } from "@/server/services/conversationSettings";
import { accessibleConversationWhere } from "@/server/services/access";
import { loadConversationMessages } from "@/server/services/messages";
import { ConversationThread } from "./ConversationThread";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const { id } = await params;
  const conversation = await prisma.conversation.findFirst({
    where: accessibleConversationWhere(userId, id),
    include: { members: { include: { slackUser: true } } },
  });
  if (!conversation) notFound();

  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  if (!installation) redirect("/");

  // Pulls anything newer than what's cached (cheap once caught up) so opening a conversation
  // always shows up-to-date messages even if the Events API webhook isn't reaching this deployment.
  // The view's first poll, straight after mount, then reconciles edits/deletions/reactions.
  await syncMessages(userId, conversation).catch(() => {});

  // Captured before the cursor is advanced below, so the view can draw its "New messages" line.
  const previousRead = await prisma.readState.findUnique({
    where: { userId_conversationId: { userId, conversationId: conversation.id } },
    select: { lastReadTs: true },
  });

  const view = await loadConversationMessages(userId, conversation);
  if (view.newestRootTs) await markConversationRead(userId, conversation.id, view.newestRootTs).catch(() => {});

  const [readers, setting] = await Promise.all([
    listReaders(conversation, userId),
    getConversationSetting(userId, conversation.id),
  ]);

  return (
    <ConversationThread
      conversationId={conversation.id}
      title={conversationLabel(conversation, installation.slackUserId)}
      type={conversation.type}
      topic={conversation.topic}
      avatarUrl={conversationAvatarUrl(conversation, installation.slackUserId)}
      initialReaders={readers}
      initialLastReadTs={previousRead?.lastReadTs ?? null}
      initialSetting={setting}
      initialMessages={view.messages}
      initialUserNames={view.userNames}
    />
  );
}
