import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { conversationLabel } from "@/lib/slack/conversationLabel";

export default async function SavedMessagesPage() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });

  const saved = await prisma.savedMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      message: {
        include: {
          author: true,
          conversation: { include: { members: { include: { slackUser: true } } } },
        },
      },
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          aria-label="Back to conversations"
        >
          ←
        </Link>
        <h1 className="gradient-text text-2xl font-bold tracking-tight">Saved messages</h1>
      </div>

      {saved.length === 0 && (
        <p className="text-zinc-500 dark:text-zinc-400">
          Nothing saved yet. Use &ldquo;Save for later&rdquo; on any message to keep it here.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {saved.map((s) => {
          const label = installation
            ? conversationLabel(s.message.conversation, installation.slackUserId)
            : (s.message.conversation.name ?? "Conversation");
          return (
            <li key={s.id}>
              <Link
                href={`/app/${s.message.conversation.id}#message-${s.message.id}`}
                className="card-surface block rounded-2xl px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-zinc-500 dark:text-zinc-400">{label}</span>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                    {new Date(s.message.createdAt).toLocaleString("en-GB", { hour12: false })}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">{s.message.author?.displayName ?? "Unknown"}:</span>{" "}
                  {s.message.deletedAt ? "Deleted message" : s.message.text}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
