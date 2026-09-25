import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncConversationsForUser } from "@/lib/slack/sync";
import { conversationLabel } from "@/lib/slack/conversationLabel";
import { ConversationList } from "./ConversationList";
import { NotificationSetup } from "./NotificationSetup";

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
    return { id: c.id, label: conversationLabel(c, installation.slackUserId), unread };
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Conversations</h1>
      <NotificationSetup />
      <ConversationList initial={items} />
    </div>
  );
}
