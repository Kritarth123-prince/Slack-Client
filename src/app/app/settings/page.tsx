import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth/session";
import { getPreferences } from "@/server/services/preferences";
import { SettingsForm } from "@/components/settings/SettingsForm";

export default async function SettingsPage() {
  const userId = await requireUserId();
  if (!userId) redirect("/");

  const prefs = await getPreferences(userId);

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
        <h1 className="gradient-text text-2xl font-bold tracking-tight">Settings</h1>
      </div>
      <SettingsForm initial={prefs} />
    </div>
  );
}
