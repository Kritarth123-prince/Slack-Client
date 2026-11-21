"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Plus } from "lucide-react";
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
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 text-left hover:bg-surface-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <WorkspaceBadge branding={active ? { name: active.name, domain: active.domain, iconUrl: active.iconUrl } : null} />
        <ChevronDown size={16} className="ml-auto shrink-0 text-subtle" />
      </button>

      {open && (
        <div className="popover-surface absolute left-0 z-30 mt-1 w-64 rounded-xl p-1 text-sm" role="menu">
          <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">Workspaces</p>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitemradio"
              aria-checked={w.active}
              disabled={switching}
              onClick={() => (w.active ? setOpen(false) : switchTo(w.id))}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-fg hover:bg-surface-2"
            >
              {w.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL
                <img src={w.iconUrl} alt="" className="h-6 w-6 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="btn-primary flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={`min-w-0 flex-1 truncate ${w.active ? "font-medium" : ""}`}>{w.name}</span>
              {w.active && <Check size={15} className="shrink-0 text-accent-text" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <a href="/api/oauth/slack" className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <span className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-line-strong">
              <Plus size={14} />
            </span>
            Add another workspace
          </a>
        </div>
      )}
    </div>
  );
}
