"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowLeft, Bell, BellOff, Bookmark, Eraser, History, MoreHorizontal, Pin, Star, Trash2 } from "lucide-react";
import { MessageBubble } from "@/components/conversation/MessageBubble";
import { Composer, type ComposerHandle } from "@/components/composer/Composer";
import { ScheduledList } from "@/components/composer/ScheduledList";
import { ThreadPanel } from "@/components/thread/ThreadPanel";
import { TypingLine } from "@/components/conversation/TypingLine";
import { ConversationGlyph } from "@/components/conversation/ConversationGlyph";
import { DeleteMyMessagesDialog } from "@/components/conversation/DeleteMyMessagesDialog";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useClickOutside } from "@/hooks/useClickOutside";
import { messageDate, dayKey, formatDayLabel } from "@/lib/slack/messageTime";
import { isRootMessage, tsBefore } from "@/lib/slack/syncHelpers";
import type { ForwardTarget, Member, MessageView } from "@/types/chat";
import type { TypingView, ReaderView } from "@/server/services/presenceSignals";
import type { ConversationSettingView } from "@/server/services/conversationSettings";

const POLL_INTERVAL_MS = 4000;
// Every Nth poll also re-reads recent history so edits, deletions, reactions and thread replies
// made in Slack arrive even without the events webhook.
const RECONCILE_EVERY_N_POLLS = 5;
const NEAR_BOTTOM_PX = 120;
// Messages from the same person this close together are grouped under one name and avatar.
const CONTINUATION_WINDOW_S = 5 * 60;
const NOTICE_MS = 3500;

type ConversationType = "PUBLIC_CHANNEL" | "PRIVATE_CHANNEL" | "DM" | "GROUP_DM";

interface MessagesResponse {
  messages: MessageView[];
  userNames: Record<string, string>;
  clearedBeforeTs: string | null;
  typing?: TypingView[];
  readers?: ReaderView[];
}

interface Notice {
  text: string;
  tone: "info" | "error";
}

const HEADER_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg";

function MenuRow({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm ${
        danger ? "text-danger hover:bg-danger-soft" : "text-fg hover:bg-surface-2"
      }`}
    >
      <span className={danger ? "" : "text-subtle"}>{icon}</span>
      {children}
    </button>
  );
}

export function ConversationThread({
  conversationId,
  title,
  type,
  topic = null,
  avatarUrl = null,
  initialMessages,
  initialUserNames,
  initialReaders = [],
  initialLastReadTs = null,
  initialSetting = { pinned: false, muted: false, clearedBeforeTs: null },
}: {
  conversationId: string;
  title: string;
  type: ConversationType;
  topic?: string | null;
  avatarUrl?: string | null;
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MessageView | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteMineOpen, setDeleteMineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const composerRef = useRef<ComposerHandle | null>(null);
  // Fixed for the life of this view so the divider doesn't jump as the poll advances the cursor.
  const [newMessagesAfterTs] = useState(initialLastReadTs);

  const [members, setMembers] = useState<Member[]>([]);
  const membersRequested = useRef(false);
  const [forwardTargets, setForwardTargets] = useState<ForwardTarget[] | null>(null);
  const forwardTargetsRequested = useRef(false);
  const [openThreadTs, setOpenThreadTs] = useState<string | null>(null);
  const openThreadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const lastPayloadRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const requestSeqRef = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const menuRef = useClickOutside<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const pinnedRef = useClickOutside<HTMLDivElement>(pinnedOpen, () => setPinnedOpen(false));

  const isDirect = type === "DM" || type === "GROUP_DM";

  function showNotice(text: string, tone: Notice["tone"] = "info") {
    setNotice({ text, tone });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }

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
        setForwardTargets(data?.conversations?.filter((c) => c.id !== conversationId).map((c) => ({ id: c.id, label: c.label })) ?? []);
      })
      .catch(() => setForwardTargets([]));
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }

  function scrollToBottom(smooth = false) {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  // First position: a linked message (from search/saved) if there is one, else the "New messages"
  // line, else the bottom. Declared before the follow-the-bottom effect so it wins on mount.
  useEffect(() => {
    const hash = window.location.hash;
    const target = hash.startsWith("#message-") ? document.getElementById(hash.slice(1)) : null;
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("message-highlight");
    } else if (hash.startsWith("#message-")) {
      // The link points at a thread reply — open its thread instead.
      const reply = initialMessages.find((m) => m.id === hash.slice("#message-".length));
      if (reply && reply.threadTs && !isRootMessage(reply)) requestAnimationFrame(() => setOpenThreadTs(reply.threadTs));
      scrollToBottom();
    } else {
      const divider = document.getElementById("new-messages-divider");
      if (divider) divider.scrollIntoView({ block: "center" });
      else scrollToBottom();
    }
    handleScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial positioning only
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom();
  }, [messages]);

  useEffect(() => {
    openThreadRef.current = openThreadTs;
  }, [openThreadTs]);

  async function refresh(options: { reconcile?: boolean; force?: boolean } = {}) {
    if (inFlightRef.current && !options.force) return;
    inFlightRef.current = true;
    const seq = ++requestSeqRef.current;
    try {
      const params = new URLSearchParams();
      if (options.reconcile) {
        params.set("reconcile", "1");
        if (openThreadRef.current) params.set("thread", openThreadRef.current);
      }
      // Only a window you're actually looking at counts as reading (and clears unread in Slack).
      if (!document.hasFocus()) params.set("read", "0");
      const res = await fetch(`/api/conversations/${conversationId}/messages?${params}`);
      if (!res.ok || seq !== requestSeqRef.current) return;
      const body = await res.text();
      // Most polls change nothing; skipping identical payloads saves re-rendering every message.
      if (body === lastPayloadRef.current) return;
      lastPayloadRef.current = body;
      const data = JSON.parse(body) as MessagesResponse;
      setMessages(data.messages);
      setUserNames(data.userNames);
      setTyping(data.typing ?? []);
      setReaders(data.readers ?? []);
      setSetting((s) => (s.clearedBeforeTs === data.clearedBeforeTs ? s : { ...s, clearedBeforeTs: data.clearedBeforeTs }));
    } finally {
      if (seq === requestSeqRef.current) inFlightRef.current = false;
    }
  }

  /** Re-reads after a change made here, discarding any optimistic state that didn't stick. */
  function reload() {
    lastPayloadRef.current = null;
    return refresh({ force: true }).catch(() => {});
  }

  // The open conversation has no live push channel, so it polls like the conversation list already
  // does — otherwise messages from other people never appear until a manual reload. Mobile
  // browsers throttle timers heavily once the tab/app is backgrounded, so also refresh the
  // instant it becomes visible again rather than waiting for the next tick.
  useEffect(() => {
    let ticks = 0;
    function tick(forceReconcile = false) {
      if (document.visibilityState !== "visible") return;
      const reconcile = forceReconcile || ticks % RECONCILE_EVERY_N_POLLS === 0;
      ticks++;
      refresh({ reconcile }).catch(() => {});
    }

    tick();
    const interval = setInterval(() => tick(), POLL_INTERVAL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") tick(true);
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable enough for polling purposes
  }, [conversationId]);

  // Opening a thread fetches its latest replies straight away rather than at the next reconcile.
  useEffect(() => {
    if (openThreadTs) refresh({ reconcile: true, force: true }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a different thread opens
  }, [openThreadTs]);

  function updateMessage(messageId: string, change: (m: MessageView) => MessageView) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? change(m) : m)));
  }

  async function send(url: string, init: RequestInit, failure: string): Promise<boolean> {
    try {
      const res = await fetch(url, init);
      if (!res.ok) showNotice(failure, "error");
      return res.ok;
    } catch {
      showNotice(failure, "error");
      return false;
    } finally {
      await reload();
    }
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  function toggleReaction(messageId: string, emoji: string) {
    // Optimistic: the pill updates on click; the reload afterwards corrects it if Slack refused.
    updateMessage(messageId, (m) => {
      const existing = m.reactions.find((r) => r.emoji === emoji);
      const reactions = existing?.reactedByMe
        ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, reactedByMe: false } : r)).filter((r) => r.count > 0)
        : existing
          ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, reactedByMe: true } : r))
          : [...m.reactions, { emoji, count: 1, reactedByMe: true }];
      return { ...m, reactions };
    });
    send(`/api/conversations/${conversationId}/messages/${messageId}/reactions`, json({ emoji }), "Couldn't update that reaction.");
  }

  function startReply(m: MessageView) {
    setOpenThreadTs(m.threadTs && m.threadTs !== m.slackTs ? m.threadTs : m.slackTs);
  }

  function saveEdit(messageId: string, text: string) {
    updateMessage(messageId, (m) => ({ ...m, text, isEdited: true }));
    send(
      `/api/conversations/${conversationId}/messages/${messageId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) },
      "Couldn't save that edit."
    );
  }

  async function confirmDeleteMessage() {
    if (!pendingDelete) return;
    setBusy(true);
    const ok = await send(
      `/api/conversations/${conversationId}/messages/${pendingDelete.id}`,
      { method: "DELETE" },
      "Couldn't delete that message."
    );
    setBusy(false);
    setPendingDelete(null);
    if (ok) showNotice("Message deleted");
  }

  function togglePin(m: MessageView) {
    updateMessage(m.id, (x) => ({ ...x, pinned: !m.pinned }));
    send(`/api/conversations/${conversationId}/messages/${m.id}/pin`, json({ pinned: !m.pinned }), "Couldn't update the pin.");
  }

  async function toggleSave(m: MessageView) {
    updateMessage(m.id, (x) => ({ ...x, savedByMe: !m.savedByMe }));
    const ok = await send(`/api/conversations/${conversationId}/messages/${m.id}/save`, { method: "POST" }, "Couldn't update saved messages.");
    if (ok) showNotice(m.savedByMe ? "Removed from saved" : "Saved for later");
  }

  async function forwardTo(messageId: string, targetConversationId: string) {
    const target = forwardTargets?.find((t) => t.id === targetConversationId);
    const ok = await send(
      `/api/conversations/${conversationId}/messages/${messageId}/forward`,
      json({ targetConversationId }),
      "Couldn't forward that message."
    );
    if (ok) showNotice(`Forwarded to ${target?.label ?? "conversation"}`);
  }

  function scrollToMessage(messageId: string) {
    setPinnedOpen(false);
    const el = document.getElementById(`message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("message-highlight");
    void el.offsetWidth; // restart the highlight animation
    el.classList.add("message-highlight");
  }

  async function updateSetting(patch: Partial<Pick<ConversationSettingView, "pinned" | "muted">>) {
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
      } else {
        showNotice("Couldn't save that change.", "error");
      }
    } catch {
      showNotice("Couldn't save that change.", "error");
    }
  }

  async function clearHistory() {
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/history`, json({ action: "clear" }));
      if (!res.ok) throw new Error("failed");
      setSetting(await res.json());
      setOpenThreadTs(null);
      await reload();
      showNotice("History cleared — only new messages will show here");
      router.refresh();
    } catch {
      showNotice("Couldn't clear the history.", "error");
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  }

  async function restoreHistory() {
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/history`, json({ action: "restore" }));
      if (!res.ok) throw new Error("failed");
      setSetting(await res.json());
      await reload();
      showNotice("Earlier messages restored");
    } catch {
      showNotice("Couldn't restore the history.", "error");
    }
  }

  // "Mark unread from here" moves the read cursor to just before this message and leaves the
  // conversation — staying would re-mark it read on the next poll.
  async function markUnreadFrom(m: MessageView) {
    const feed = messages.filter(isRootMessage);
    const index = feed.findIndex((x) => x.id === m.id);
    const previous = index > 0 ? feed[index - 1].slackTs : tsBefore(m.slackTs);
    try {
      await fetch(`/api/conversations/${conversationId}/read`, json({ lastReadTs: previous }));
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

  function handleSent() {
    nearBottomRef.current = true;
    reload();
  }

  const pinnedMessages = messages.filter((m) => m.pinned && !m.isDeleted);

  // Replies are grouped by their thread's root ts and hidden from the main feed — they only show
  // up inside the thread panel, matching real Slack's behaviour.
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

  const feedMessages = useMemo(() => messages.filter(isRootMessage), [messages]);
  const openThread = openThreadTs ? messages.find((m) => m.slackTs === openThreadTs) : undefined;
  const openThreadReplies = openThreadTs ? (repliesByThread.get(openThreadTs) ?? []) : [];

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
  }, [readers, feedMessages]);

  const rootTypingNames = typing.filter((t) => t.threadTs === "").map((t) => t.name);
  const threadTypingNames = openThreadTs ? typing.filter((t) => t.threadTs === openThreadTs).map((t) => t.name) : [];

  const bubbleProps = {
    userNames,
    onReply: startReply,
    onToggleReaction: toggleReaction,
    onSaveEdit: saveEdit,
    onDelete: setPendingDelete,
    onTogglePin: togglePin,
    onToggleSave: toggleSave,
    forwardTargets,
    ensureForwardTargetsLoaded,
    onForwardTo: forwardTo,
    onNotice: (text: string) => showNotice(text),
  };

  // Index of the first feed message past the read cursor from before this open, if any.
  const firstNewIndex =
    newMessagesAfterTs === null ? -1 : feedMessages.findIndex((m) => m.slackTs > newMessagesAfterTs && !m.isSelf);

  function isContinuation(i: number): boolean {
    const m = feedMessages[i];
    const prev = feedMessages[i - 1];
    if (!prev || i === firstNewIndex || !m.authorId || prev.authorId !== m.authorId) return false;
    if (prev.isDeleted || m.isDeleted || repliesByThread.has(prev.slackTs)) return false;
    if (dayKey(messageDate(prev.slackTs)) !== dayKey(messageDate(m.slackTs))) return false;
    return Number(m.slackTs) - Number(prev.slackTs) < CONTINUATION_WINDOW_S;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className="relative flex min-w-0 flex-1 flex-col"
        aria-label={title}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft text-sm font-semibold text-accent-text">
            Drop files to attach
          </div>
        )}

        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 sm:px-4">
          <Link href="/app" className={`${HEADER_BUTTON} md:hidden`} aria-label="Back to conversations">
            <ArrowLeft size={18} />
          </Link>
          <ConversationGlyph type={type} label={title} avatarUrl={avatarUrl} seed={conversationId} size={22} />
          <div className="ml-1.5 min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-fg">{title.replace(/^#/, "")}</h1>
            {topic && <p className="truncate text-xs text-subtle">{topic}</p>}
          </div>

          {pinnedMessages.length > 0 && (
            <div ref={pinnedRef} className="relative">
              <button
                type="button"
                onClick={() => setPinnedOpen((v) => !v)}
                aria-expanded={pinnedOpen}
                title="Pinned messages"
                className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg"
              >
                <Pin size={15} /> {pinnedMessages.length}
              </button>
              {pinnedOpen && (
                <div className="popover-surface absolute right-0 z-30 mt-1 flex max-h-80 w-80 max-w-[90vw] flex-col overflow-y-auto rounded-xl p-1 max-sm:fixed max-sm:inset-x-2 max-sm:top-16 max-sm:w-auto max-sm:max-w-none">
                  <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">Pinned messages</p>
                  {pinnedMessages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => scrollToMessage(m.id)}
                      className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                    >
                      <span className="text-xs font-semibold text-fg">{m.isSelf ? "You" : m.authorName}</span>
                      <span className="line-clamp-2 text-sm text-muted">{m.text || "Attachment"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => updateSetting({ pinned: !setting.pinned })}
            aria-pressed={setting.pinned}
            aria-label={setting.pinned ? "Unstar conversation" : "Star conversation"}
            title={setting.pinned ? "Unstar" : "Star (keeps it at the top)"}
            className={`${HEADER_BUTTON} ${setting.pinned ? "text-warning hover:text-warning" : ""}`}
          >
            <Star size={17} fill={setting.pinned ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            onClick={() => updateSetting({ muted: !setting.muted })}
            aria-pressed={setting.muted}
            aria-label={setting.muted ? "Unmute conversation" : "Mute conversation"}
            title={setting.muted ? "Unmute notifications" : "Mute notifications"}
            className={HEADER_BUTTON}
          >
            {setting.muted ? <BellOff size={17} /> : <Bell size={17} />}
          </button>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Conversation options"
              className={HEADER_BUTTON}
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div role="menu" className="popover-surface absolute right-0 z-30 mt-1 flex w-64 flex-col rounded-xl p-1">
                <Link
                  href="/app/saved"
                  role="menuitem"
                  className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm text-fg hover:bg-surface-2"
                >
                  <Bookmark size={15} className="text-subtle" /> Saved messages
                </Link>
                <div className="my-1 border-t border-line" />
                {setting.clearedBeforeTs ? (
                  <MenuRow icon={<History size={15} />} onClick={restoreHistory}>
                    Show cleared messages
                  </MenuRow>
                ) : (
                  <MenuRow
                    icon={<Eraser size={15} />}
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmClear(true);
                    }}
                  >
                    Clear history for me…
                  </MenuRow>
                )}
                {isDirect && (
                  <MenuRow
                    icon={<Trash2 size={15} />}
                    danger
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteMineOpen(true);
                    }}
                  >
                    Delete my messages…
                  </MenuRow>
                )}
              </div>
            )}
          </div>
        </header>

        {setting.clearedBeforeTs && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-muted">
            <Eraser size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">You cleared this conversation&apos;s history — only newer messages show here.</span>
            <button type="button" onClick={restoreHistory} className="shrink-0 font-semibold text-accent-text hover:underline">
              Show all
            </button>
          </div>
        )}

        <div ref={scrollRef} onScroll={handleScroll} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {feedMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <ConversationGlyph type={type} label={title} avatarUrl={avatarUrl} seed={conversationId} size={40} />
              <p className="text-sm font-semibold text-fg">{setting.clearedBeforeTs ? "History cleared" : "No messages yet"}</p>
              <p className="max-w-xs text-sm text-subtle">
                {setting.clearedBeforeTs
                  ? "New messages will appear here. Earlier ones are still in Slack."
                  : `This is the start of ${isDirect ? "your conversation with " : ""}${title}.`}
              </p>
            </div>
          ) : (
            <div className="message-feed mx-auto w-full max-w-4xl px-3 pt-6 pb-3 sm:px-6">
              {feedMessages.map((m, i) => (
                <Fragment key={m.id}>
                  {(i === 0 || dayKey(messageDate(feedMessages[i - 1].slackTs)) !== dayKey(messageDate(m.slackTs))) && (
                    <div className="flex items-center gap-3 py-1 text-xs font-medium text-subtle" role="separator" suppressHydrationWarning>
                      <span className="h-px flex-1 bg-line" />
                      <span className="rounded-full border border-line bg-surface px-2.5 py-0.5" suppressHydrationWarning>
                        {formatDayLabel(messageDate(m.slackTs))}
                      </span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  {i === firstNewIndex && (
                    <div id="new-messages-divider" className="flex items-center gap-3 text-xs font-semibold text-danger" role="separator">
                      <span className="h-px flex-1 bg-danger/40" />
                      New messages
                      <span className="h-px flex-1 bg-danger/40" />
                    </div>
                  )}
                  <MessageBubble
                    message={m}
                    context="feed"
                    continuation={isContinuation(i)}
                    replyCount={repliesByThread.get(m.slackTs)?.length ?? 0}
                    seenBy={seenByMessageId.get(m.id)}
                    onOpenThread={setOpenThreadTs}
                    onMarkUnread={markUnreadFrom}
                    {...bubbleProps}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {!atBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="popover-surface absolute bottom-36 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-fg hover:bg-surface-2"
          >
            <ArrowDown size={14} /> Jump to latest
          </button>
        )}

        {notice && (
          <div
            role="status"
            className={`absolute bottom-36 left-1/2 z-20 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-sm font-medium shadow-lg ${
              notice.tone === "error" ? "bg-danger text-white" : "bg-fg text-canvas"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="shrink-0 px-3 pb-3 sm:px-6">
          <div className="mx-auto w-full max-w-4xl">
            <ScheduledList conversationId={conversationId} refreshKey={scheduledRefresh} />
            <TypingLine names={rootTypingNames} />
            <Composer
              key={conversationId}
              conversationId={conversationId}
              members={members}
              ensureMembersLoaded={ensureMembersLoaded}
              placeholder={`Message ${title}`}
              onSent={handleSent}
              onScheduled={() => {
                setScheduledRefresh((n) => n + 1);
                showNotice("Message scheduled");
              }}
              attachRef={composerRef}
            />
          </div>
        </div>
      </section>

      {openThread && (
        <ThreadPanel
          conversationId={conversationId}
          conversationTitle={title}
          rootMessage={openThread}
          replies={openThreadReplies}
          userNames={userNames}
          members={members}
          ensureMembersLoaded={ensureMembersLoaded}
          onToggleReaction={toggleReaction}
          onSaveEdit={saveEdit}
          onDelete={setPendingDelete}
          onTogglePin={togglePin}
          onToggleSave={toggleSave}
          forwardTargets={forwardTargets}
          ensureForwardTargetsLoaded={ensureForwardTargetsLoaded}
          onForwardTo={forwardTo}
          onNotice={(text) => showNotice(text)}
          onSent={reload}
          onClose={() => setOpenThreadTs(null)}
          typingNames={threadTypingNames}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this message?"
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={confirmDeleteMessage}
        onCancel={() => setPendingDelete(null)}
      >
        It&apos;ll be removed from Slack for everyone in the conversation. This can&apos;t be undone.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmClear}
        title="Clear history for you?"
        confirmLabel="Clear history"
        busy={busy}
        onConfirm={clearHistory}
        onCancel={() => setConfirmClear(false)}
      >
        Hides every message so far in <strong className="font-semibold text-fg">{title}</strong> from this app, for you only.
        Nothing is deleted in Slack, and you can bring them back any time from this conversation&apos;s menu.
      </ConfirmDialog>

      {deleteMineOpen && (
        <DeleteMyMessagesDialog
          conversationId={conversationId}
          conversationTitle={title}
          onClose={() => setDeleteMineOpen(false)}
          onFinished={reload}
        />
      )}
    </div>
  );
}
