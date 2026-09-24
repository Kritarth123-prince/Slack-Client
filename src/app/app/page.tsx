import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncConversationsForUser } from "@/lib/slack/sync";

function conversationLabel(name: string | null, type: string): string {
  if (name) return type === "PUBLIC_CHANNEL" || type === "PRIVATE_CHANNEL" ? `#${name}` : name;
  return type === "DM" ? "Direct message" : "Group message";
}

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
    orderBy: [{ lastMessageAt: "desc" }],
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Conversations</h1>

      {conversations.length === 0 && (
        <p className="text-zinc-500 dark:text-zinc-400">
          No conversations found yet. Make sure you&apos;re a member of at least one channel or DM in Slack.
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <Link
              href={`/app/${conversation.id}`}
              className="block rounded-lg border border-black/[.08] px-4 py-3 hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.03]"
            >
              {conversationLabel(conversation.name, conversation.type)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
