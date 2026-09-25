"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { avatarGradient, initials } from "@/lib/ui/avatar";

export interface ConversationListItem {
  id: string;
  label: string;
  unread: boolean;
  type: "PUBLIC_CHANNEL" | "PRIVATE_CHANNEL" | "DM" | "GROUP_DM";
  avatarUrl: string | null;
}

const POLL_INTERVAL_MS = 15000;

function ConversationAvatar({ item }: { item: ConversationListItem }) {
  const isChannel = item.type === "PUBLIC_CHANNEL" || item.type === "PRIVATE_CHANNEL";

  if (item.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL, not a local/static asset
      <img
        src={item.avatarUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-sm"
      />
    );
  }

  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
      style={{ backgroundImage: avatarGradient(item.id) }}
    >
      {isChannel ? "#" : initials(item.label)}
    </div>
  );
}

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
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_INTERVAL_MS);

    // Mobile browsers throttle timers heavily once the tab/app is backgrounded, so also refresh
    // the instant it becomes visible again (e.g. unlocking the phone back into this tab) instead
    // of waiting for the next tick — this is what keeps unread highlighting feeling real-time.
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
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
    <ul className="flex flex-col gap-2">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/app/${c.id}`}
            className={`card-surface group flex items-center gap-3 rounded-2xl px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
              c.unread ? "ring-1 ring-inset ring-[color-mix(in_srgb,var(--brand-from)_35%,transparent)]" : ""
            }`}
          >
            <ConversationAvatar item={c} />
            <span
              className={`flex-1 truncate ${
                c.unread ? "font-semibold text-black dark:text-zinc-50" : "text-zinc-700 dark:text-zinc-300"
              }`}
            >
              {c.label}
            </span>
            {c.unread && (
              <span
                className="btn-primary h-2.5 w-2.5 shrink-0 rounded-full"
                aria-label="Unread"
              />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
