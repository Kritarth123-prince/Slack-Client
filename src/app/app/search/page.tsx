import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { SearchPanel } from "@/components/search/SearchPanel";

export default async function SearchPage() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 sm:p-6">
      <div className="flex items-center gap-3">
        <Link
          href="/app"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] md:hidden dark:text-zinc-400 dark:hover:bg-white/[.06]"
          aria-label="Back to conversations"
        >
          ←
        </Link>
        <h1 className="gradient-text text-2xl font-bold tracking-tight">Search</h1>
      </div>
      <SearchPanel />
    </div>
  );
}
