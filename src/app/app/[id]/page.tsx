import { redirect, notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncMessages } from "@/lib/slack/sync";
import { conversationLabel } from "@/lib/slack/conversationLabel";
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

  await syncMessages(userId, conversation).catch(() => {});

  const [messages, workspaceUsers] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      orderBy: { slackTs: "asc" },
      include: { author: true },
    }),
    prisma.slackUser.findMany({ where: { workspaceId: conversation.workspaceId } }),
  ]);

  const userNames = Object.fromEntries(workspaceUsers.map((u) => [u.slackUserId, u.displayName]));

  return (
    <ConversationThread
      conversationId={conversation.id}
      title={conversationLabel(conversation, installation.slackUserId)}
      initialMessages={messages.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        authorName: m.author?.displayName ?? "Unknown",
      }))}
      initialUserNames={userNames}
    />
  );
}
