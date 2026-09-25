"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { SlackText } from "@/lib/slack/formatSlackText";
import type { SlackFileView } from "@/lib/slack/messageFiles";
import { avatarGradient, initials } from "@/lib/ui/avatar";

export interface ReactionView {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface ForwardedFromView {
  authorName: string;
  text: string;
}

export interface MessageView {
  id: string;
  slackTs: string;
  threadTs: string | null;
  text: string;
  createdAt: string;
  authorName: string;
  authorAvatarUrl: string | null;
  isSelf: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  pinned: boolean;
  savedByMe: boolean;
  forwardedFrom: ForwardedFromView | null;
  files: SlackFileView[];
  reactions: ReactionView[];
}

interface Member {
  id: string;
  displayName: string;
}

interface ForwardTarget {
  id: string;
  label: string;
}

interface ApiMessage {
  id: string;
  slackTs: string;
  threadTs: string | null;
  text: string;
  createdAt: string;
  author: { displayName: string; avatarUrl: string | null } | null;
  isSelf: boolean;
  isEdited: boolean;
  isDeleted: boolean;
  pinned: boolean;
  savedByMe: boolean;
  forwardedFrom: ForwardedFromView | null;
  files: SlackFileView[];
  reactions: ReactionView[];
}

const POLL_INTERVAL_MS = 4000;
const NEAR_BOTTOM_PX = 120;

const EMOJI_GLYPHS: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  heart: "❤️",
  joy: "😂",
  tada: "🎉",
  eyes: "👀",
  white_check_mark: "✅",
  fire: "🔥",
  clap: "👏",
  raised_hands: "🙌",
  thinking_face: "🤔",
  pray: "🙏",
};

function emojiGlyph(name: string): string {
  return EMOJI_GLYPHS[name] ?? `:${name}:`;
}

const QUICK_REACTIONS = ["+1", "heart", "joy", "tada", "eyes", "white_check_mark"];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileAttachment({ file }: { file: SlackFileView }) {
  if (file.isImage) {
    return (
      <a href={file.proxyUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block max-w-xs">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied, dynamic-origin image; next/image would need domain config for our own route */}
        <img
          src={file.proxyUrl}
          alt={file.name}
          className="rounded-xl border border-black/[.08] shadow-sm dark:border-white/[.145]"
        />
      </a>
    );
  }

  return (
    <a
      href={file.proxyUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-xs flex-col gap-0.5 rounded-xl border border-black/[.08] bg-white/60 px-3 py-2 text-sm shadow-sm hover:bg-white dark:border-white/[.145] dark:bg-black/20 dark:hover:bg-black/40"
    >
      <span className="truncate font-medium">📎 {file.name}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {file.filetype.toUpperCase()} {formatFileSize(file.size)}
      </span>
    </a>
  );
}

function Avatar({ seed, name, avatarUrl }: { seed: string; name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL, not a local/static asset
      <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover shadow-sm" />
    );
  }

  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm"
      style={{ backgroundImage: avatarGradient(seed) }}
    >
      {initials(name)}
    </div>
  );
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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const membersRequested = useRef(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ threadTs: string; authorName: string; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [forwardingId, setForwardingId] = useState<string | null>(null);
  const [forwardTargets, setForwardTargets] = useState<ForwardTarget[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
      data.messages.map((m) => ({
        id: m.id,
        slackTs: m.slackTs,
        threadTs: m.threadTs,
        text: m.text,
        createdAt: m.createdAt,
        authorName: m.author?.displayName ?? "Unknown",
        authorAvatarUrl: m.author?.avatarUrl ?? null,
        isSelf: m.isSelf,
        isEdited: m.isEdited,
        isDeleted: m.isDeleted,
        pinned: m.pinned,
        savedByMe: m.savedByMe,
        forwardedFrom: m.forwardedFrom,
        files: m.files,
        reactions: m.reactions,
      }))
    );
    setUserNames(data.userNames);
  }

  // The open thread has no live push channel, so it polls like the conversation list already
  // does — otherwise messages from other people never appear until a manual reload. Mobile
  // browsers throttle timers heavily once the tab/app is backgrounded, so also refresh the
  // instant it becomes visible again rather than waiting for the next tick.
  useEffect(() => {
    function tick() {
      if (document.visibilityState !== "visible") return;
      refresh().catch(() => {});
      // Lets "automatically set Away after inactivity" track actual app usage rather than just
      // tab-open time — being in an open thread counts as activity.
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

  async function toggleReaction(messageId: string, emoji: string) {
    setPickerFor(null);
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
    setMenuFor(null);
    setReplyTo({ threadTs: m.threadTs ?? m.slackTs, authorName: m.authorName, text: m.text });
    inputRef.current?.focus();
  }

  function startEdit(m: MessageView) {
    setMenuFor(null);
    setEditingId(m.id);
    setEditingText(m.text);
  }

  async function saveEdit(messageId: string) {
    const text = editingText.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setEditingId(null);
        await refresh();
      } else {
        setError("Couldn't save that edit.");
      }
    } catch {
      setError("Couldn't save that edit.");
    }
  }

  async function handleDelete(messageId: string) {
    setMenuFor(null);
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
    setMenuFor(null);
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
    setMenuFor(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${m.id}/save`, { method: "POST" });
      if (res.ok) await refresh();
    } catch {
      // transient failure — saved state just won't update this time
    }
  }

  async function openForward(messageId: string) {
    setMenuFor(null);
    setForwardingId(messageId);
    if (!forwardTargets) {
      try {
        const res = await fetch("/api/conversations");
        const data = (await res.json()) as { conversations?: { id: string; label: string }[] } | null;
        setForwardTargets(data?.conversations?.map((c) => ({ id: c.id, label: c.label })) ?? []);
      } catch {
        setForwardTargets([]);
      }
    }
  }

  async function forwardTo(messageId: string, targetConversationId: string) {
    setForwardingId(null);
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

  function handleTextChange(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setText(value);

    const caret = e.target.selectionStart ?? value.length;
    const uptoCaret = value.slice(0, caret);
    const atIndex = uptoCaret.lastIndexOf("@");
    if (atIndex === -1 || /\s/.test(uptoCaret.slice(atIndex + 1))) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(uptoCaret.slice(atIndex + 1));
    ensureMembersLoaded();
  }

  function selectMention(member: Member) {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? text.length;
    const uptoCaret = text.slice(0, caret);
    const atIndex = uptoCaret.lastIndexOf("@");
    if (atIndex === -1) return;

    const before = text.slice(0, atIndex);
    const after = text.slice(caret);
    const inserted = `@${member.displayName} `;
    setText(before + inserted + after);
    setMentionMap((prev) => ({ ...prev, [member.displayName]: member.id }));
    setMentionQuery(null);
    requestAnimationFrame(() => input?.focus());
  }

  function resolveMentionsForSend(value: string): string {
    let result = value;
    for (const [name, id] of Object.entries(mentionMap)) {
      result = result.replace(new RegExp(`@${escapeRegExp(name)}\\b`, "g"), `<@${id}>`);
    }
    return result;
  }

  const filteredMembers =
    mentionQuery === null
      ? []
      : members.filter((m) => m.displayName.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: resolveMentionsForSend(text), threadTs: replyTo?.threadTs }),
      });
      if (!res.ok) throw new Error("send failed");
      setText("");
      setMentionMap({});
      setReplyTo(null);
      await refresh();
    } catch {
      setError("Couldn't send that message. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-2xl flex-col p-6">
      <div className="mb-4 flex items-center gap-3">
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

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.map((m) => (
          <div
            key={m.id}
            id={`message-${m.id}`}
            className={`group flex items-end gap-2 ${m.isSelf ? "flex-row-reverse" : ""}`}
          >
            <Avatar seed={m.authorName} name={m.authorName} avatarUrl={m.authorAvatarUrl} />
            <div className={`flex max-w-[75%] flex-col gap-1 ${m.isSelf ? "items-end" : "items-start"}`}>
              {(!m.isSelf || m.isDeleted || m.pinned) && (
                <div className="flex items-center gap-1.5 px-1">
                  {!m.isSelf && (
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{m.authorName}</span>
                  )}
                  {m.pinned && <span className="text-xs" title="Pinned">📌</span>}
                  {m.isDeleted && (
                    <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-500">
                      Deleted
                    </span>
                  )}
                </div>
              )}

              {m.threadTs && m.threadTs !== m.slackTs && (
                <span className="px-1 text-[10px] text-zinc-400 dark:text-zinc-500">↳ Thread reply</span>
              )}

              {m.forwardedFrom && (
                <div className="max-w-full rounded-lg border-l-2 border-zinc-300 bg-black/[.02] px-2 py-1 text-xs text-zinc-500 dark:border-zinc-600 dark:bg-white/[.03] dark:text-zinc-400">
                  ↪ Forwarded from <span className="font-medium">{m.forwardedFrom.authorName}</span>
                </div>
              )}

              {editingId === m.id ? (
                <div className="flex w-full flex-col gap-1">
                  <input
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(m.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    className="card-surface w-full rounded-xl px-3 py-1.5 text-sm text-black outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] dark:text-zinc-50"
                  />
                  <div className="flex gap-2 px-1 text-xs">
                    <button onClick={() => saveEdit(m.id)} className="font-semibold text-[var(--brand-from)]">
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-zinc-500 dark:text-zinc-400">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                m.text && (
                  <div
                    className={`${
                      m.isSelf
                        ? "btn-primary rounded-2xl rounded-br-sm px-4 py-2 text-white"
                        : "card-surface rounded-2xl rounded-bl-sm px-4 py-2"
                    } ${m.isDeleted ? "opacity-60" : ""}`}
                  >
                    <SlackText text={m.text} userNames={userNames} />
                    {m.isEdited && <span className="ml-1 text-[10px] opacity-70">(edited)</span>}
                  </div>
                )
              )}

              {m.files.map((file) => (
                <FileAttachment key={file.id} file={file} />
              ))}

              <div className="relative flex flex-wrap items-center gap-1">
                {m.reactions.map((r) => (
                  <button
                    key={r.emoji}
                    onClick={() => toggleReaction(m.id, r.emoji)}
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      r.reactedByMe
                        ? "border-[var(--brand-from)] bg-[color-mix(in_srgb,var(--brand-from)_12%,transparent)]"
                        : "border-black/[.08] hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
                    }`}
                  >
                    {emojiGlyph(r.emoji)} {r.count}
                  </button>
                ))}
                {!m.isDeleted && (
                  <button
                    onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                    className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-500 hover:bg-black/[.03] dark:border-white/[.145] dark:text-zinc-400 dark:hover:bg-white/[.05]"
                  >
                    +
                  </button>
                )}
                {!m.isDeleted && (
                  <button
                    onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                    className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-500 hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
                    aria-label="More actions"
                  >
                    ⋯
                  </button>
                )}

                {pickerFor === m.id && (
                  <div
                    className={`card-surface absolute bottom-full z-10 mb-1 flex gap-1 rounded-xl p-1 ${
                      m.isSelf ? "right-0" : "left-0"
                    }`}
                  >
                    {QUICK_REACTIONS.map((name) => (
                      <button
                        key={name}
                        onClick={() => toggleReaction(m.id, name)}
                        className="rounded-lg p-1 text-base hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                      >
                        {emojiGlyph(name)}
                      </button>
                    ))}
                  </div>
                )}

                {menuFor === m.id && (
                  <div
                    className={`card-surface absolute bottom-full z-10 mb-1 flex w-40 flex-col overflow-hidden rounded-xl py-1 text-sm ${
                      m.isSelf ? "right-0" : "left-0"
                    }`}
                  >
                    <button onClick={() => startReply(m)} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                      💬 Reply in thread
                    </button>
                    {m.isSelf && (
                      <button onClick={() => startEdit(m)} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                        ✏️ Edit
                      </button>
                    )}
                    <button onClick={() => togglePin(m)} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                      📌 {m.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button onClick={() => openForward(m.id)} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                      ↪️ Forward
                    </button>
                    <button onClick={() => toggleSave(m)} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                      🔖 {m.savedByMe ? "Unsave" : "Save for later"}
                    </button>
                    {m.isSelf && (
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="px-3 py-1.5 text-left text-red-500 hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                )}

                {forwardingId === m.id && (
                  <div
                    className={`card-surface absolute bottom-full z-20 mb-1 flex max-h-56 w-56 flex-col overflow-y-auto rounded-xl py-1 text-sm ${
                      m.isSelf ? "right-0" : "left-0"
                    }`}
                  >
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Forward to…
                    </div>
                    {forwardTargets === null && <div className="px-3 py-1.5 text-zinc-500">Loading…</div>}
                    {forwardTargets?.length === 0 && <div className="px-3 py-1.5 text-zinc-500">No conversations</div>}
                    {forwardTargets?.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => forwardTo(m.id, t.id)}
                        className="truncate px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                      >
                        {t.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setForwardingId(null)}
                      className="border-t border-black/[.06] px-3 py-1.5 text-left text-zinc-500 dark:border-white/[.08]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {replyTo && (
        <div className="card-surface mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs">
          <span className="truncate text-zinc-600 dark:text-zinc-300">
            Replying to <span className="font-semibold">{replyTo.authorName}</span>: {replyTo.text}
          </span>
          <button onClick={() => setReplyTo(null)} className="shrink-0 text-zinc-500 dark:text-zinc-400" aria-label="Cancel reply">
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className="relative mt-4 flex gap-2">
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <ul className="card-surface absolute bottom-full mb-1 w-64 rounded-xl">
            {filteredMembers.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => selectMention(m)}
                  className="block w-full px-3 py-2 text-left text-sm first:rounded-t-xl last:rounded-b-xl hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  {m.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          value={text}
          onChange={handleTextChange}
          placeholder="Message... (type @ to mention someone)"
          className="card-surface flex-1 rounded-full px-4 py-2 text-black outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={sending}
          className="btn-primary rounded-full px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
