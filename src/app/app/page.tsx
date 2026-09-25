import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncConversationsForUser } from "@/lib/slack/sync";
import { conversationLabel, conversationAvatarUrl } from "@/lib/slack/conversationLabel";
import { ConversationList } from "./ConversationList";
import { NotificationSetup } from "./NotificationSetup";
import { StatusMenu } from "./StatusMenu";

export default async function AppHome() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) redirect("/");

  await syncConversationsForUser(userId).catch(() => {});

  const conversations = await prisma.conversation.findMany({
    where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false },
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    include: { members: { include: { slackUser: true } } },
  });

  const readStates = await prisma.readState.findMany({
    where: { userId, conversationId: { in: conversations.map((c) => c.id) } },
  });
  const readMap = new Map(readStates.map((r) => [r.conversationId, r.lastReadTs]));

  const items = conversations.map((c) => {
    const lastRead = readMap.get(c.id);
    const unread = Boolean(c.lastMessageTs) && (!lastRead || lastRead < c.lastMessageTs!);
    return {
      id: c.id,
      label: conversationLabel(c, installation.slackUserId),
      unread,
      type: c.type,
      avatarUrl: conversationAvatarUrl(c, installation.slackUserId),
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="gradient-text text-2xl font-bold tracking-tight">Conversations</h1>
        <StatusMenu />
      </div>
      <NotificationSetup />
      <ConversationList initial={items} />
    </div>
  );
}
