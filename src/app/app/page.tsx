import { redirect } from "next/navigation";
import { after } from "next/server";
import { MessagesSquare } from "lucide-react";
import { requireUserId } from "@/lib/auth/session";
import { hasCachedConversations, syncWorkspace } from "@/server/services/conversations";

export default async function AppHome() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  // Straight after connecting a workspace there's nothing cached to show, so that first sync is
  // waited for (the sidebar's list fetches as soon as it mounts, by which point it's done). After
  // that the refresh runs once the page has been sent, so opening the list is instant.
  if (await hasCachedConversations(userId)) after(() => syncWorkspace(userId));
  else await syncWorkspace(userId);

  // Phones show the sidebar (the list) instead of this; on desktop it's the empty state beside it.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-text" aria-hidden>
        <MessagesSquare size={24} />
      </span>
      <h1 className="text-base font-semibold text-fg">Pick up where you left off</h1>
      <p className="max-w-sm text-sm text-muted">
        Choose a conversation from the sidebar, or press{" "}
        <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-sans text-xs text-fg">Ctrl K</kbd> to jump
        to one.
      </p>
    </div>
  );
}
