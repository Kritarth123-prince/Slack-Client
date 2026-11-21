import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/** The header bar shared by the Search, Saved and Settings pages: back to the list on phones, a title, optional actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-6">
      <Link
        href="/app"
        className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg md:hidden"
        aria-label="Back to conversations"
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold text-fg">{title}</h1>
        {description && <p className="truncate text-xs text-subtle">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
