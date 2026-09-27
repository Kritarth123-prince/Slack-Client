import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, Bookmark, Settings } from "lucide-react";
import { requireUserId } from "@/lib/auth/session";
import { loadConversationList } from "@/server/services/conversations";
import { getWorkspaceBranding } from "@/server/services/workspace";
import { WorkspaceBadge } from "@/components/sidebar/WorkspaceBadge";
import { ConversationList } from "./ConversationList";
import { NotificationSetup } from "./NotificationSetup";
import { StatusMenu } from "./StatusMenu";

const NAV = [
  { href: "/app/search", label: "Search", Icon: Search },
  { href: "/app/saved", label: "Saved", Icon: Bookmark },
  { href: "/app/settings", label: "Settings", Icon: Settings },
] as const;

export default async function AppHome() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const [items, branding] = await Promise.all([loadConversationList(userId), getWorkspaceBranding(userId)]);

  return (
    <>
      {/* Phones: the list is the whole screen. Desktop has it in the sidebar, so it isn't repeated here. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 sm:p-6 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <WorkspaceBadge branding={branding} size="lg" />
          <div className="flex shrink-0 items-center gap-1">
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                title={label}
                aria-label={label}
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
              >
                <Icon size={18} />
              </Link>
            ))}
          </div>
        </div>
        <StatusMenu />
        <NotificationSetup />
        <ConversationList initial={items} />
      </div>

      <div className="hidden flex-1 flex-col items-center justify-center gap-4 p-6 text-center md:flex">
        <div className="w-full max-w-md">
          <NotificationSetup />
        </div>
        <div className="btn-primary flex h-14 w-14 items-center justify-center rounded-2xl text-2xl" aria-hidden>
          💬
        </div>
        <p className="text-zinc-500 dark:text-zinc-400">Pick a conversation from the sidebar to start chatting.</p>
      </div>
    </>
  );
}
