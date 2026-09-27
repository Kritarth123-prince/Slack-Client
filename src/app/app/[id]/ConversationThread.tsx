"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { Composer } from "@/components/composer/Composer";
import { ThreadPanel } from "@/components/thread/ThreadPanel";
import type { ForwardTarget, Member, MessageView } from "@/types/chat";

const POLL_INTERVAL_MS = 4000;
const NOTIFY_SYNC_INTERVAL_MS = 15000;
const NEAR_BOTTOM_PX = 120;

interface ApiMessage extends Omit<MessageView, "authorName" | "authorAvatarUrl"> {
  author: { displayName: string; avatarUrl: string | null } | null;
}

export function ConversationThread({
  conversationId,
  title,
  initialMessages,
  initialUserNames,
}: {
  conversationId: string;
  title: string;
  initialMessages: MessageView[];
  initialUserNames: Record<string, string>;
}) {
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [userNames, setUserNames] = useState<Record<string, string>>(initialUserNames);
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const membersRequested = useRef(false);
  const [forwardTargets, setForwardTargets] = useState<ForwardTarget[] | null>(null);
  const forwardTargetsRequested = useRef(false);
  const [openThreadTs, setOpenThreadTs] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  function ensureMembersLoaded() {
    if (membersRequested.current) return;
    membersRequested.current = true;
    fetch(`/api/conversations/${conversationId}/members`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { members?: Member[] } | null) => {
        if (data?.members) setMembers(data.members);
      })
      .catch(() => {});
  }

  function ensureForwardTargetsLoaded() {
    if (forwardTargetsRequested.current) return;
    forwardTargetsRequested.current = true;
    fetch("/api/conversations")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { conversations?: { id: string; label: string }[] } | null) => {
        setForwardTargets(data?.conversations?.map((c) => ({ id: c.id, label: c.label })) ?? []);
      })
      .catch(() => setForwardTargets([]));
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function refresh() {
    const res = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ApiMessage[]; userNames: Record<string, string> };
    setMessages(
      data.messages.map(({ author, ...m }) => ({
        ...m,
        authorName: author?.displayName ?? "Unknown",
        authorAvatarUrl: author?.avatarUrl ?? null,
      }))
    );
    setUserNames(data.userNames);
  }

  // The open conversation has no live push channel, so it polls like the conversation list already
  // does — otherwise messages from other people never appear until a manual reload. Mobile
  // browsers throttle timers heavily once the tab/app is backgrounded, so also refresh the
  // instant it becomes visible again rather than waiting for the next tick.
  useEffect(() => {
    function tick() {
      if (document.visibilityState !== "visible") return;
      refresh().catch(() => {});
      // Lets "automatically set Away after inactivity" track actual app usage rather than just
      // tab-open time — being in an open conversation counts as activity.
      fetch("/api/status/heartbeat", { method: "POST" }).catch(() => {});
    }

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable enough for polling purposes
  }, [conversationId]);

  // Deliberately separate from the poll above and NOT gated on visibility: this is what triggers
  // the server-side check for new messages across every conversation (not just this open one) and
  // sends push notifications for them. Without it, being inside a specific conversation with the
  // tab backgrounded would mean no notifications for anything happening elsewhere in the
  // workspace, since the conversation list (which normally drives this) isn't even mounted while a
  // conversation is open. Runs at the same cadence as the conversation list's own background sync.
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/conversations").catch(() => {});
    }, NOTIFY_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function toggleReaction(messageId: string, emoji: string) {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) await refresh();
    } catch {
      // transient failure — the reaction just won't update this time
    }
  }

  function startReply(m: MessageView) {
    const rootTs = m.threadTs && m.threadTs !== m.slackTs ? m.threadTs : m.slackTs;
    setOpenThreadTs(rootTs);
  }

  async function saveEdit(messageId: string, text: string) {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) await refresh();
      else setError("Couldn't save that edit.");
    } catch {
      setError("Couldn't save that edit.");
    }
  }

  async function handleDelete(messageId: string) {
    if (!window.confirm("Delete this message?")) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" });
      if (res.ok) await refresh();
      else setError("Couldn't delete that message.");
    } catch {
      setError("Couldn't delete that message.");
    }
  }

  async function togglePin(m: MessageView) {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${m.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !m.pinned }),
      });
      if (res.ok) await refresh();
    } catch {
      // transient failure — pin state just won't update this time
    }
  }

  async function toggleSave(m: MessageView) {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${m.id}/save`, { method: "POST" });
      if (res.ok) await refresh();
    } catch {
      // transient failure — saved state just won't update this time
    }
  }

  async function forwardTo(messageId: string, targetConversationId: string) {
    try {
      await fetch(`/api/conversations/${conversationId}/messages/${messageId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetConversationId }),
      });
    } catch {
      setError("Couldn't forward that message.");
    }
  }

  function scrollToMessage(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const pinnedMessages = messages.filter((m) => m.pinned && !m.isDeleted);

  // Replies are grouped by their thread's root ts and hidden from the main feed — they only show
  // up inside the thread panel, matching real Slack's behaviour. No backend/schema support is
  // needed for this: threadTs is already on every message, and reply counts are derived here
  // rather than stored anywhere (same as the schema's own comment on Message.threadTs intends).
  const repliesByThread = useMemo(() => {
    const map = new Map<string, MessageView[]>();
    for (const m of messages) {
      if (m.threadTs && m.threadTs !== m.slackTs) {
        const list = map.get(m.threadTs) ?? [];
        list.push(m);
        map.set(m.threadTs, list);
      }
    }
    return map;
  }, [messages]);

  const feedMessages = messages.filter((m) => !m.threadTs || m.threadTs === m.slackTs);
  const openThread = openThreadTs ? messages.find((m) => m.slackTs === openThreadTs) : undefined;
  const openThreadReplies = openThreadTs ? repliesByThread.get(openThreadTs) ?? [] : [];

  const bubbleProps = {
    userNames,
    onReply: startReply,
    onToggleReaction: toggleReaction,
    onSaveEdit: saveEdit,
    onDelete: handleDelete,
    onTogglePin: togglePin,
    onToggleSave: toggleSave,
    forwardTargets,
    ensureForwardTargetsLoaded,
    onForwardTo: forwardTo,
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-x-hidden p-3 sm:p-6">
      <div className="mb-4 flex items-center gap-2 sm:gap-3">
        <Link
          href="/app"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          aria-label="Back to conversations"
        >
          ←
        </Link>
        <h1 className="gradient-text flex-1 truncate text-lg font-bold">{title}</h1>
        <Link
          href="/app/saved"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          aria-label="Saved messages"
          title="Saved messages"
        >
          🔖
        </Link>
      </div>

      {pinnedMessages.length > 0 && (
        <div className="card-surface mb-3 flex flex-col gap-1 rounded-xl px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            📌 Pinned ({pinnedMessages.length})
          </span>
          <div className="flex flex-col gap-0.5">
            {pinnedMessages.map((m) => (
              <button
                key={m.id}
                onClick={() => scrollToMessage(m.id)}
                className="truncate text-left text-xs text-zinc-600 hover:underline dark:text-zinc-300"
              >
                <span className="font-medium">{m.authorName}:</span> {m.text}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-1 py-2">
        {feedMessages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            context="feed"
            replyCount={repliesByThread.get(m.slackTs)?.length ?? 0}
            onOpenThread={setOpenThreadTs}
            {...bubbleProps}
          />
        ))}
      </div>

      <div className="mt-4">
        <Composer
          key={conversationId}
          conversationId={conversationId}
          members={members}
          ensureMembersLoaded={ensureMembersLoaded}
          onSent={refresh}
        />
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {openThread && (
        <ThreadPanel
          conversationId={conversationId}
          rootMessage={openThread}
          replies={openThreadReplies}
          userNames={userNames}
          members={members}
          ensureMembersLoaded={ensureMembersLoaded}
          onToggleReaction={toggleReaction}
          onSaveEdit={saveEdit}
          onDelete={handleDelete}
          onTogglePin={togglePin}
          onToggleSave={toggleSave}
          forwardTargets={forwardTargets}
          ensureForwardTargetsLoaded={ensureForwardTargetsLoaded}
          onForwardTo={forwardTo}
          onSent={refresh}
          onClose={() => setOpenThreadTs(null)}
        />
      )}
    </div>
  );
}
