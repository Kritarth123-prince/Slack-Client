"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Bell, BellOff, Star } from "lucide-react";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { Composer, type ComposerHandle } from "@/components/composer/Composer";
import { ScheduledList } from "@/components/composer/ScheduledList";
import { ThreadPanel } from "@/components/thread/ThreadPanel";
import { TypingLine } from "@/components/conversation/TypingLine";
import { CustomEmojiProvider } from "@/lib/ui/customEmoji";
import { messageDate, dayKey, formatDayLabel } from "@/lib/slack/messageTime";
import type { ForwardTarget, Member, MessageView } from "@/types/chat";
import type { TypingView, ReaderView } from "@/server/services/presenceSignals";
import type { ConversationSettingView } from "@/server/services/conversationSettings";

const POLL_INTERVAL_MS = 4000;
const NOTIFY_SYNC_INTERVAL_MS = 15000;
const NEAR_BOTTOM_PX = 120;

interface ApiMessage extends Omit<MessageView, "authorName" | "authorAvatarUrl"> {
  author: { displayName: string; avatarUrl: string | null } | null;
}

interface MessagesResponse {
  messages: ApiMessage[];
  userNames: Record<string, string>;
  typing?: TypingView[];
  readers?: ReaderView[];
}

export function ConversationThread({
  conversationId,
  title,
  initialMessages,
  initialUserNames,
  initialReaders = [],
  initialLastReadTs = null,
  initialSetting = { pinned: false, muted: false },
}: {
  conversationId: string;
  title: string;
  initialMessages: MessageView[];
  initialUserNames: Record<string, string>;
  initialReaders?: ReaderView[];
  /** The read cursor as it was before this open — the "New messages" line goes just after it. */
  initialLastReadTs?: string | null;
  initialSetting?: ConversationSettingView;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [userNames, setUserNames] = useState<Record<string, string>>(initialUserNames);
  const [typing, setTyping] = useState<TypingView[]>([]);
  const [readers, setReaders] = useState<ReaderView[]>(initialReaders);
  const [setting, setSetting] = useState<ConversationSettingView>(initialSetting);
  const [scheduledRefresh, setScheduledRefresh] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<ComposerHandle | null>(null);
  // Fixed for the life of this view so the divider doesn't jump as the poll advances the cursor.
  const [newMessagesAfterTs] = useState(initialLastReadTs);

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
    const data = (await res.json()) as MessagesResponse;
    setMessages(
      data.messages.map(({ author, ...m }) => ({
        ...m,
        authorName: author?.displayName ?? "Unknown",
        authorAvatarUrl: author?.avatarUrl ?? null,
      }))
    );
    setUserNames(data.userNames);
    setTyping(data.typing ?? []);
    setReaders(data.readers ?? []);
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

  async function updateSetting(patch: Partial<ConversationSettingView>) {
    setSetting((s) => ({ ...s, ...patch }));
    try {
      const res = await fetch(`/api/conversations/${conversationId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setSetting(await res.json());
        router.refresh();
      }
    } catch {
      // transient failure — the toggle just won't stick this time
    }
  }

  // "Mark unread from here" moves the read cursor to just before this message and leaves the
  // conversation — staying would re-mark it read on the next poll.
  async function markUnreadFrom(m: MessageView) {
    const feed = messages.filter((x) => !x.threadTs || x.threadTs === x.slackTs);
    const index = feed.findIndex((x) => x.id === m.id);
    const previous = index > 0 ? feed[index - 1].slackTs : "0";
    try {
      await fetch(`/api/conversations/${conversationId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastReadTs: previous }),
      });
    } finally {
      router.push("/app");
      router.refresh();
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) composerRef.current?.addFiles(files);
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

  // "Seen by" goes on the newest feed message each reader has reached, not on every message
  // below their cursor — one label per person, like a receipt, rather than a wall of names.
  const seenByMessageId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const reader of readers) {
      let last: MessageView | undefined;
      for (const m of feedMessages) {
        if (m.slackTs <= reader.lastReadTs) last = m;
        else break;
      }
      if (!last) continue;
      map.set(last.id, [...(map.get(last.id) ?? []), reader.name]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feedMessages is derived from messages each render
  }, [readers, messages]);

  const rootTypingNames = typing.filter((t) => t.threadTs === "").map((t) => t.name);
  const threadTypingNames = openThreadTs ? typing.filter((t) => t.threadTs === openThreadTs).map((t) => t.name) : [];

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

  // Index of the first feed message past the read cursor from before this open, if any.
  const firstNewIndex =
    newMessagesAfterTs === null
      ? -1
      : feedMessages.findIndex((m) => m.slackTs > newMessagesAfterTs && !m.isSelf);

  return (
    <CustomEmojiProvider>
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative mx-auto flex h-full w-full max-w-2xl flex-col overflow-x-hidden p-3 sm:p-6 ${
        dragging ? "ring-2 ring-inset ring-[var(--brand-from)]" : ""
      }`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_srgb,var(--brand-from)_8%,transparent)] text-sm font-semibold text-[var(--brand-from)]">
          Drop files to attach
        </div>
      )}
      <div className="mb-4 flex items-center gap-2 sm:gap-3">
        <Link
          href="/app"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] md:hidden dark:text-zinc-400 dark:hover:bg-white/[.06]"
          aria-label="Back to conversations"
        >
          ←
        </Link>
        <h1 className="gradient-text min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
        <button
          type="button"
          onClick={() => updateSetting({ pinned: !setting.pinned })}
          aria-pressed={setting.pinned}
          aria-label={setting.pinned ? "Unpin conversation" : "Pin conversation to the top"}
          title={setting.pinned ? "Unpin conversation" : "Pin conversation to the top"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
            setting.pinned ? "text-amber-500" : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          <Star size={18} fill={setting.pinned ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={() => updateSetting({ muted: !setting.muted })}
          aria-pressed={setting.muted}
          aria-label={setting.muted ? "Unmute conversation" : "Mute conversation"}
          title={setting.muted ? "Unmute notifications" : "Mute notifications"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
            setting.muted ? "text-red-500" : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {setting.muted ? <BellOff size={18} /> : <Bell size={18} />}
        </button>
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

      <div ref={scrollRef} onScroll={handleScroll} className="message-feed flex-1 overflow-y-auto overflow-x-hidden px-1 py-2">
        {feedMessages.map((m, i) => (
          <div key={m.id} className="contents">
            {(i === 0 || dayKey(messageDate(feedMessages[i - 1].slackTs)) !== dayKey(messageDate(m.slackTs))) && (
              <div
                className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
                role="separator"
                suppressHydrationWarning
              >
                <span className="h-px flex-1 bg-black/[.06] dark:bg-white/[.08]" />
                {formatDayLabel(messageDate(m.slackTs))}
                <span className="h-px flex-1 bg-black/[.06] dark:bg-white/[.08]" />
              </div>
            )}
            {i === firstNewIndex && (
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-red-500" role="separator">
                <span className="h-px flex-1 bg-red-500/40" />
                New messages
                <span className="h-px flex-1 bg-red-500/40" />
              </div>
            )}
            <MessageBubble
              message={m}
              context="feed"
              replyCount={repliesByThread.get(m.slackTs)?.length ?? 0}
              seenBy={seenByMessageId.get(m.id)}
              onOpenThread={setOpenThreadTs}
              onMarkUnread={markUnreadFrom}
              {...bubbleProps}
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <ScheduledList conversationId={conversationId} refreshKey={scheduledRefresh} />
        <TypingLine names={rootTypingNames} />
        <Composer
          key={conversationId}
          conversationId={conversationId}
          members={members}
          ensureMembersLoaded={ensureMembersLoaded}
          onSent={refresh}
          onScheduled={() => setScheduledRefresh((n) => n + 1)}
          attachRef={composerRef}
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
          typingNames={threadTypingNames}
        />
      )}
    </div>
    </CustomEmojiProvider>
  );
}
