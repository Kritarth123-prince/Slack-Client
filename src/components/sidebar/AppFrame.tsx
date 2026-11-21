"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Sidebar + main area. On desktop both are always visible. On phones, `/app` *is* the sidebar
 * (the conversation list, full screen) and every other page is shown on its own. One sidebar
 * instance serves both, so its list poll and status menu are never mounted twice.
 */
export function AppFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/app";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <aside
        className={`${isHome ? "flex w-full" : "hidden"} shrink-0 flex-col border-r border-line bg-sidebar md:flex md:w-[17.5rem]`}
        aria-label="Conversations"
      >
        {sidebar}
      </aside>
      <main className={`${isHome ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col overflow-hidden`}>{children}</main>
    </div>
  );
}
