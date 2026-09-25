"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export interface ConversationListItem {
  id: string;
  label: string;
  unread: boolean;
}

const POLL_INTERVAL_MS = 15000;

export function ConversationList({ initial }: { initial: ConversationListItem[] }) {
  const [items, setItems] = useState<ConversationListItem[]>(initial);

  useEffect(() => {
    let cancelled = false;

    function load() {
      fetch("/api/conversations")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { conversations?: ConversationListItem[] } | null) => {
          if (!cancelled && data?.conversations) setItems(data.conversations);
        })
        .catch(() => {});
    }

    // Refresh immediately on mount (e.g. returning here after reading a thread) instead of
    // only showing the page's initial server-rendered snapshot until the next poll tick.
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (items.length === 0) {
    return (
      <p className="text-zinc-500 dark:text-zinc-400">
        No conversations found yet. Make sure you&apos;re a member of at least one channel or DM in Slack.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/app/${c.id}`}
            className={`flex items-center justify-between gap-3 rounded-lg border border-black/[.08] px-4 py-3 hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.03] ${
              c.unread ? "font-semibold text-black dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            <span>{c.label}</span>
            {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
