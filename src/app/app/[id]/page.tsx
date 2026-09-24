import { redirect, notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncMessages } from "@/lib/slack/sync";
import { ConversationThread } from "./ConversationThread";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) notFound();

  await syncMessages(userId, conversation).catch(() => {});

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: { author: true },
  });

  return (
    <ConversationThread
      conversationId={conversation.id}
      title={conversation.name ? `#${conversation.name}` : "Direct message"}
      initialMessages={messages.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt.toISOString(),
        authorName: m.author?.displayName ?? "Unknown",
      }))}
    />
  );
}
