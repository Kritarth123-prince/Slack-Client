"use client";

import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import type { ScheduledMessageView } from "@/server/services/scheduled";

/** Messages queued via "Send later" for this conversation, with a way to cancel each before Slack posts it. */
export function ScheduledList({ conversationId, refreshKey }: { conversationId: string; refreshKey: number }) {
  const [items, setItems] = useState<ScheduledMessageView[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/conversations/${conversationId}/scheduled`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { scheduled?: ScheduledMessageView[] } | null) => {
        if (!cancelled && data?.scheduled) setItems(data.scheduled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey]);

  async function cancel(id: string) {
    setItems((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/conversations/${conversationId}/scheduled?scheduledMessageId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-2 flex flex-col gap-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-subtle">
        <Clock size={12} /> Scheduled ({items.length})
      </span>
      {items.map((m) => (
        <div key={m.id} className="flex items-center gap-2">
          <span className="shrink-0 font-medium tabular-nums text-fg">
            {new Date(m.postAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted">{m.text}</span>
          <button
            type="button"
            onClick={() => cancel(m.id)}
            aria-label="Cancel scheduled message"
            title="Cancel"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-danger-soft hover:text-danger"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
