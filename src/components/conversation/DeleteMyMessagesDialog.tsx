"use client";

import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Dialog, buttonStyles } from "@/components/ui/Dialog";
import type { DeleteOwnMessagesResult } from "@/server/services/conversationHistory";

type Phase = "confirm" | "running" | "done" | "error";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deletes every message the user sent in a DM from Slack, for everyone. Runs as a series of short
 * batches (see deleteOwnMessagesBatch) with live progress, honours Slack's rate-limit back-off, and
 * can be stopped part-way. Mount it only while open, so each opening starts from the confirmation.
 */
export function DeleteMyMessagesDialog({
  conversationId,
  conversationTitle,
  onClose,
  onFinished,
}: {
  conversationId: string;
  conversationTitle: string;
  onClose: () => void;
  /** Called once deletion stops for any reason, so the view can refresh. */
  onFinished: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [understood, setUnderstood] = useState(false);
  const [deleted, setDeleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  async function run() {
    setPhase("running");
    cancelRef.current = false;
    let before: string | null = null;
    let total = 0;
    let totalFailed = 0;
    try {
      while (!cancelRef.current) {
        const res = await fetch(`/api/conversations/${conversationId}/history/mine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ before }),
        });
        const data = (await res.json().catch(() => null)) as (DeleteOwnMessagesResult & { error?: string }) | null;
        if (!res.ok || !data || data.error) throw new Error(data?.error ?? "failed");

        total += data.deleted;
        totalFailed += data.failed;
        setDeleted(total);
        setFailed(totalFailed);
        before = data.before;
        if (data.done) break;

        // Slack asked us to slow down — wait it out, still stoppable.
        for (let s = data.retryAfterSeconds ?? 0; s > 0 && !cancelRef.current; s--) {
          setWaitSeconds(s);
          await sleep(1000);
        }
        setWaitSeconds(null);
      }
      setStopped(cancelRef.current);
      setPhase("done");
    } catch (err) {
      setError(
        (err as Error).message === "missing_scope"
          ? "Your Slack connection is missing a permission this needs. Reconnect Slack from Settings and try again."
          : "Something went wrong talking to Slack. Anything already deleted stays deleted — you can run this again to finish."
      );
      setPhase("error");
    } finally {
      setWaitSeconds(null);
      onFinished();
    }
  }

  const titles: Record<Phase, string> = {
    confirm: "Delete your messages?",
    running: "Deleting your messages…",
    done: stopped ? "Stopped" : "Done",
    error: "Couldn't finish",
  };

  return (
    <Dialog
      open
      title={titles[phase]}
      onClose={onClose}
      busy={phase === "running"}
      footer={
        phase === "confirm" ? (
          <>
            <button type="button" onClick={onClose} className={buttonStyles.secondary}>
              Cancel
            </button>
            <button type="button" onClick={run} disabled={!understood} className={buttonStyles.danger}>
              Delete my messages
            </button>
          </>
        ) : phase === "running" ? (
          <button type="button" onClick={() => (cancelRef.current = true)} className={buttonStyles.secondary}>
            Stop
          </button>
        ) : (
          <button type="button" data-autofocus onClick={onClose} className={buttonStyles.primary}>
            Close
          </button>
        )
      }
    >
      {phase === "confirm" && (
        <div className="flex flex-col gap-3">
          <p>
            This permanently deletes every message <strong className="font-semibold text-fg">you</strong> sent in{" "}
            <strong className="font-semibold text-fg">{conversationTitle}</strong> — from Slack itself, for everyone in the
            conversation, including replies you posted in threads.
          </p>
          <p>Messages other people sent aren&apos;t touched; Slack doesn&apos;t allow deleting those.</p>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-danger-soft px-3 py-2.5 text-danger">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--danger)]"
            />
            <span>I understand this can&apos;t be undone.</span>
          </label>
          <p className="text-xs text-subtle">
            Only want a fresh start in this app? Use <em>Clear history</em> instead — it hides messages for you only and can be
            undone.
          </p>
        </div>
      )}

      {phase === "running" && (
        <div className="flex items-start gap-3" aria-live="polite">
          <LoaderCircle size={18} className="mt-0.5 shrink-0 animate-spin text-accent-text" />
          <div>
            <p className="text-fg">
              {deleted} {deleted === 1 ? "message" : "messages"} deleted so far.
            </p>
            <p className="mt-1 text-xs text-subtle">
              {waitSeconds
                ? `Slack asked us to slow down — continuing in ${waitSeconds}s.`
                : "Long conversations take a while; Slack limits how fast messages can be deleted."}
            </p>
          </div>
        </div>
      )}

      {phase === "done" && (
        <p aria-live="polite">
          {deleted === 0 && !stopped
            ? "You had no messages left to delete in this conversation."
            : `${deleted} ${deleted === 1 ? "message was" : "messages were"} deleted${stopped ? " before you stopped" : ""}.`}
          {failed > 0 && ` ${failed} couldn't be deleted (Slack refused them).`}
        </p>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-2">
          <p>{error}</p>
          {deleted > 0 && <p className="text-xs text-subtle">{deleted} deleted before it stopped.</p>}
        </div>
      )}
    </Dialog>
  );
}
