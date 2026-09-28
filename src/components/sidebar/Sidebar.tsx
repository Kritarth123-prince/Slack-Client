import Link from "next/link";
import { Search, Bookmark, Settings } from "lucide-react";
import { ConversationList, type ConversationListItem } from "@/app/app/ConversationList";
import { StatusMenu } from "@/app/app/StatusMenu";
import { WorkspaceSwitcher } from "@/components/sidebar/WorkspaceSwitcher";
import type { WorkspaceOption } from "@/lib/slack/installation";

const NAV = [
  { href: "/app/search", label: "Search", Icon: Search },
  { href: "/app/saved", label: "Saved", Icon: Bookmark },
  { href: "/app/settings", label: "Settings", Icon: Settings },
] as const;

/** Desktop-only persistent sidebar: workspace switcher, quick nav, status, and the live conversation list. */
export function Sidebar({ items, workspaces }: { items: ConversationListItem[]; workspaces: WorkspaceOption[] }) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] md:flex">
      <div className="px-3 pt-3 pb-1">
        <WorkspaceSwitcher workspaces={workspaces} />
      </div>

      <nav className="flex items-center gap-1 px-3 py-2" aria-label="Primary">
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
        <div className="ml-auto">
          <StatusMenu />
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4">
        <ConversationList initial={items} compact />
      </div>

      <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        <kbd className="rounded border border-black/[.1] px-1 dark:border-white/[.15]">Ctrl</kbd> +{" "}
        <kbd className="rounded border border-black/[.1] px-1 dark:border-white/[.15]">K</kbd> to jump to a conversation
      </p>
    </aside>
  );
}
