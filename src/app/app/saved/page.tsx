import Link from "next/link";
import { redirect } from "next/navigation";
import { Bookmark } from "lucide-react";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { conversationLabel } from "@/lib/slack/conversationLabel";
import { getActiveInstallation } from "@/lib/slack/installation";
import { formatFullDateTime, messageDate } from "@/lib/slack/messageTime";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlackText } from "@/lib/slack/formatSlackText";

export default async function SavedMessagesPage() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const installation = await getActiveInstallation(userId);

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
    <>
      <PageHeader title="Saved" description="Messages you've saved for later" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          {saved.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-subtle">
                <Bookmark size={20} />
              </span>
              <p className="text-sm font-semibold text-fg">Nothing saved yet</p>
              <p className="max-w-xs text-sm text-subtle">Hover a message and choose the bookmark to keep it here.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {saved.map((s) => {
                const label = installation
                  ? conversationLabel(s.message.conversation, installation.slackUserId)
                  : (s.message.conversation.name ?? "Conversation");
                return (
                  <li key={s.id}>
                    <Link
                      href={`/app/${s.message.conversation.id}#message-${s.message.id}`}
                      className="card-surface block rounded-xl px-4 py-3 transition-colors hover:border-line-strong"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-muted">{label}</span>
                        <span className="shrink-0 tabular-nums text-subtle" suppressHydrationWarning>
                          {formatFullDateTime(messageDate(s.message.slackTs))}
                        </span>
                      </div>
                      <div className="mt-1.5 text-sm text-fg">
                        <span className="font-semibold">{s.message.author?.displayName ?? "Unknown"}</span>
                        <div className="line-clamp-3 text-muted">
                          {s.message.deletedAt ? <em>This message was deleted.</em> : <SlackText text={s.message.text} userNames={{}} />}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
