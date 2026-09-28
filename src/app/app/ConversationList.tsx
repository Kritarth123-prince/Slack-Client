"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { avatarGradient, initials } from "@/lib/ui/avatar";

export interface ConversationListItem {
  id: string;
  label: string;
  unread: boolean;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  type: "PUBLIC_CHANNEL" | "PRIVATE_CHANNEL" | "DM" | "GROUP_DM";
  avatarUrl: string | null;
}

const POLL_INTERVAL_MS = 15000;

function ConversationAvatar({ item, compact }: { item: ConversationListItem; compact: boolean }) {
  const isChannel = item.type === "PUBLIC_CHANNEL" || item.type === "PRIVATE_CHANNEL";
  const size = compact ? "h-8 w-8 text-xs rounded-lg" : "h-10 w-10 text-sm rounded-xl";

  if (item.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL, not a local/static asset
      <img src={item.avatarUrl} alt="" className={`${size} shrink-0 object-cover shadow-sm`} />
    );
  }

  return (
    <div
      className={`${size} flex shrink-0 items-center justify-center font-semibold text-white`}
      style={{ backgroundImage: avatarGradient(item.id) }}
    >
      {isChannel ? "#" : initials(item.label)}
    </div>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) {
    return <span className="btn-primary h-2.5 w-2.5 shrink-0 rounded-full" aria-label="Unread" />;
  }
  return (
    <span
      className="btn-primary flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function ConversationList({ initial, compact = false }: { initial: ConversationListItem[]; compact?: boolean }) {
  const [items, setItems] = useState<ConversationListItem[]>(initial);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    function load() {
      // Deliberately NOT gated on document.visibilityState: this call is what triggers the
      // server-side catch-up + push-notification check (syncAllConversationsAndNotify), so a
      // background/unfocused tab still needs it to run in order to notify you of new messages —
      // gating it on visibility would mean push notifications only ever fire once you've already
      // opened the app, defeating their purpose.
      fetch("/api/conversations")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { conversations?: ConversationListItem[] } | null) => {
          if (!cancelled && data?.conversations) setItems(data.conversations);
        })
        .catch(() => {});

      // Activity heartbeat IS gated on visibility, unlike the sync above — this is what "away
      // after inactivity" measures, so a backgrounded/unfocused tab must NOT count as activity.
      if (document.visibilityState === "visible") {
        fetch("/api/status/heartbeat", { method: "POST" }).catch(() => {});
      }
    }

    // Refresh immediately on mount (e.g. returning here after reading a thread) instead of
    // only showing the page's initial server-rendered snapshot until the next poll tick.
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);

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
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No conversations found yet. Make sure you&apos;re a member of at least one channel or DM in Slack.
      </p>
    );
  }

  return (
    <ul className={`flex flex-col ${compact ? "gap-1" : "gap-2"}`}>
      {items.map((c) => {
        const active = pathname === `/app/${c.id}`;
        return (
          <li key={c.id}>
            <Link
              href={`/app/${c.id}`}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center gap-3 transition-all ${
                compact
                  ? `rounded-xl px-2.5 py-2 ${active ? "bg-[color-mix(in_srgb,var(--brand-from)_12%,transparent)]" : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"}`
                  : `card-surface rounded-2xl px-4 py-3 hover:-translate-y-0.5 hover:shadow-lg ${
                      c.unread ? "ring-1 ring-inset ring-[color-mix(in_srgb,var(--brand-from)_35%,transparent)]" : ""
                    }`
              }`}
            >
              <ConversationAvatar item={c} compact={compact} />
              <span
                className={`min-w-0 flex-1 truncate ${compact ? "text-sm" : ""} ${
                  c.muted
                    ? "text-zinc-400 dark:text-zinc-500"
                    : c.unread || active
                      ? "font-semibold text-black dark:text-zinc-50"
                      : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {c.label}
              </span>
              {c.pinned && (
                <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500" title="Pinned" aria-label="Pinned">
                  ★
                </span>
              )}
              {c.muted && (
                <span className="shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500" title="Muted" aria-label="Muted">
                  🔕
                </span>
              )}
              {c.unread && !c.muted && <UnreadBadge count={c.unreadCount} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
