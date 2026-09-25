import Link from "next/link";
import { requireUserId } from "@/lib/auth/session";

export default async function Home() {
  const userId = await requireUserId();

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <main className="card-surface flex w-full max-w-md flex-col items-center gap-6 rounded-3xl p-10 text-center">
        <div
          className="btn-primary flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          aria-hidden
        >
          💬
        </div>

        <h1 className="gradient-text text-3xl font-bold tracking-tight">Slack Web</h1>

        {userId ? (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">You&apos;re connected to Slack.</p>
            <Link
              href="/app"
              className="btn-primary w-full rounded-full px-5 py-3 text-sm font-semibold text-white"
            >
              Open messages
            </Link>
            <a
              href="/api/auth/logout"
              className="text-sm text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-700 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-200"
            >
              Log out
            </a>
          </>
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">Sign in with Slack to get started.</p>
            <a
              href="/api/oauth/slack"
              className="btn-primary w-full rounded-full px-5 py-3 text-sm font-semibold text-white"
            >
              Connect Slack
            </a>
          </>
        )}
      </main>
    </div>
  );
}
