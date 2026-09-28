"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { WorkspaceBadge } from "@/components/sidebar/WorkspaceBadge";
import type { WorkspaceOption } from "@/lib/slack/installation";

/** Workspace name/icon that opens a menu to switch between connected workspaces or add another. */
export function WorkspaceSwitcher({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const active = workspaces.find((w) => w.active) ?? workspaces[0] ?? null;

  async function switchTo(workspaceId: string) {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (res.ok) {
        setOpen(false);
        router.push("/app");
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1 rounded-xl px-1 py-1 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <WorkspaceBadge branding={active ? { name: active.name, domain: active.domain, iconUrl: active.iconUrl } : null} />
        <ChevronDown size={16} className="ml-auto shrink-0 text-zinc-500 dark:text-zinc-400" />
      </button>

      {open && (
        <div className="card-surface absolute left-0 z-30 mt-1 w-64 rounded-xl p-1 text-sm" role="menu">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitemradio"
              aria-checked={w.active}
              disabled={switching}
              onClick={() => (w.active ? setOpen(false) : switchTo(w.id))}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05] ${
                w.active ? "font-semibold" : ""
              }`}
            >
              {w.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL
                <img src={w.iconUrl} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="btn-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs text-white">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.active && <span className="text-xs text-[var(--brand-from)]">✓</span>}
            </button>
          ))}
          <a
            href="/api/oauth/slack"
            className="mt-1 flex items-center gap-2 rounded-lg border-t border-black/[.06] px-2 py-1.5 text-zinc-600 hover:bg-black/[.04] dark:border-white/[.08] dark:text-zinc-300 dark:hover:bg-white/[.05]"
          >
            <Plus size={14} /> Add another workspace
          </a>
        </div>
      )}
    </div>
  );
}
