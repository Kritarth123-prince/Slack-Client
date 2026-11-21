import Link from "next/link";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { requireUserId } from "@/lib/auth/session";

// Codes the OAuth callback redirects here with (see api/oauth/slack/callback).
const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: "Slack sign-in was cancelled. Connect again whenever you're ready.",
  invalid_state: "That sign-in link expired or was opened in a different browser. Please try again.",
  insufficient_scope:
    "Slack didn't grant all the permissions this app needs. Check the User Token Scopes in your Slack app's settings, then connect again.",
  oauth_error: "Slack sign-in didn't complete. Please try again.",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [userId, { error }] = await Promise.all([requireUserId(), searchParams]);
  const errorMessage = error ? (OAUTH_ERRORS[error] ?? OAUTH_ERRORS.oauth_error) : null;

  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center bg-canvas px-4 py-16">
      <main className="card-surface flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl px-8 py-10 text-center">
        <span className="btn-primary flex h-12 w-12 items-center justify-center rounded-xl" aria-hidden>
          <MessagesSquare size={24} />
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-fg">Slack Web</h1>
          <p className="text-sm text-muted">
            {userId ? "You're connected to Slack." : "A fast, focused client for your Slack workspace."}
          </p>
        </div>

        {errorMessage && !userId && (
          <p className="flex w-full gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-left text-sm text-warning" role="alert">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            {errorMessage}
          </p>
        )}

        {userId ? (
          <div className="flex w-full flex-col items-center gap-3">
            <Link href="/app" className="btn-primary flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold">
              Open messages
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-sm text-subtle underline-offset-4 hover:text-fg hover:underline">
                Log out
              </button>
            </form>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-3">
            <a href="/api/oauth/slack" className="btn-primary flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold">
              Connect with Slack
            </a>
            <p className="text-xs text-subtle">
              Signs in with your own Slack account, so you only ever see what you can already see in Slack.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
