"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BellOff, ChevronDown } from "lucide-react";
import { ConversationGlyph } from "@/components/conversation/ConversationGlyph";

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

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />;
  return (
    <span
      className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg tabular-nums"
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Row({ item, active }: { item: ConversationListItem; active: boolean }) {
  const emphasised = item.unread && !item.muted;
  return (
    <li>
      <Link
        href={`/app/${item.id}`}
        aria-current={active ? "page" : undefined}
        className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors ${
          active
            ? "bg-accent-soft text-accent-text"
            : emphasised
              ? "text-fg hover:bg-surface-2"
              : "text-muted hover:bg-surface-2 hover:text-fg"
        }`}
      >
        <ConversationGlyph type={item.type} label={item.label} avatarUrl={item.avatarUrl} seed={item.id} />
        <span className={`min-w-0 flex-1 truncate ${emphasised || active ? "font-semibold" : ""} ${item.muted ? "opacity-60" : ""}`}>
          {item.label}
        </span>
        {item.muted && <BellOff size={13} className="shrink-0 text-subtle" aria-label="Muted" />}
        {emphasised && <UnreadBadge count={item.unreadCount} />}
      </Link>
    </li>
  );
}

function Section({
  title,
  items,
  pathname,
}: {
  title: string;
  items: ConversationListItem[];
  pathname: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  const unreadHidden = collapsed ? items.filter((i) => i.unread && !i.muted) : [];
  // A collapsed section still shows what needs attention, like Slack.
  const visible = collapsed ? [...unreadHidden, ...items.filter((i) => pathname === `/app/${i.id}` && !unreadHidden.includes(i))] : items;

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-semibold text-subtle hover:text-fg"
      >
        <ChevronDown size={14} className={`transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        {title}
      </button>
      <ul className="flex flex-col gap-px">
        {visible.map((item) => (
          <Row key={item.id} item={item} active={pathname === `/app/${item.id}`} />
        ))}
      </ul>
    </section>
  );
}

export function ConversationList({ initial }: { initial: ConversationListItem[] }) {
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
      <p className="px-2 py-6 text-center text-sm text-subtle">
        No conversations yet. Join a channel or start a DM in Slack and it&apos;ll appear here.
      </p>
    );
  }

  const starred = items.filter((i) => i.pinned);
  const rest = items.filter((i) => !i.pinned);
  const channels = rest.filter((i) => i.type === "PUBLIC_CHANNEL" || i.type === "PRIVATE_CHANNEL");
  const direct = rest.filter((i) => i.type === "DM" || i.type === "GROUP_DM");

  return (
    <div>
      <Section title="Starred" items={starred} pathname={pathname} />
      <Section title="Direct messages" items={direct} pathname={pathname} />
      <Section title="Channels" items={channels} pathname={pathname} />
    </div>
  );
}
