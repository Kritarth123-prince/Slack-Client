"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Search, Settings, SquarePen } from "lucide-react";
import { openQuickSwitcher } from "@/components/sidebar/QuickSwitcher";

const NAV = [
  { href: "/app/search", label: "Search messages", Icon: Search },
  { href: "/app/saved", label: "Saved", Icon: Bookmark },
  { href: "/app/settings", label: "Settings", Icon: Settings },
] as const;

const ROW = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm";

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2" aria-label="Primary">
      <button type="button" onClick={openQuickSwitcher} className={`${ROW} text-muted hover:bg-surface-2 hover:text-fg`}>
        <SquarePen size={16} className="shrink-0" />
        <span className="flex-1 text-left">Jump to…</span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 font-sans text-[10px] text-subtle md:inline">Ctrl K</kbd>
      </button>
      {NAV.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${ROW} ${active ? "bg-accent-soft font-medium text-accent-text" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
