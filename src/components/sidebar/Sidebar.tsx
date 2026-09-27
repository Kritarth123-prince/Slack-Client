import Link from "next/link";
import { Search, Bookmark, Settings } from "lucide-react";
import { ConversationList, type ConversationListItem } from "@/app/app/ConversationList";
import { StatusMenu } from "@/app/app/StatusMenu";
import { WorkspaceBadge } from "@/components/sidebar/WorkspaceBadge";
import type { WorkspaceBranding } from "@/server/services/workspace";

const NAV = [
  { href: "/app/search", label: "Search", Icon: Search },
  { href: "/app/saved", label: "Saved", Icon: Bookmark },
  { href: "/app/settings", label: "Settings", Icon: Settings },
] as const;

/** Desktop-only persistent sidebar: workspace branding, quick nav, status, and the live conversation list. */
export function Sidebar({ items, branding }: { items: ConversationListItem[]; branding: WorkspaceBranding | null }) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] md:flex">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <WorkspaceBadge branding={branding} />
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
    </aside>
  );
}
