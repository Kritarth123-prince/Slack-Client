import Link from "next/link";
import { requireUserId } from "@/lib/auth/session";

export default async function Home() {
  const userId = await requireUserId();

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-6 py-32 px-6 text-center">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Slack Web
        </h1>

        {userId ? (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              You&apos;re connected to Slack.
            </p>
            <Link
              href="/app"
              className="rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Open messages
            </Link>
            <a
              href="/api/auth/logout"
              className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Log out
            </a>
          </>
        ) : (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              Sign in with Slack to get started.
            </p>
            <a
              href="/api/oauth/slack"
              className="rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Connect Slack
            </a>
          </>
        )}
      </main>
    </div>
  );
}
