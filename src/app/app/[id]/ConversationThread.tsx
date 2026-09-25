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

export interface MessageView {
  id: string;
  text: string;
  createdAt: string;
  authorName: string;
  authorAvatarUrl: string | null;
  isSelf: boolean;
  files: SlackFileView[];
  reactions: ReactionView[];
}

interface Member {
  id: string;
  displayName: string;
}

interface ApiMessage {
  id: string;
  text: string;
  createdAt: string;
  author: { displayName: string; avatarUrl: string | null } | null;
  isSelf: boolean;
  files: SlackFileView[];
  reactions: ReactionView[];
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function refresh() {
    const res = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ApiMessage[]; userNames: Record<string, string> };
    setMessages(
      data.messages.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt,
        authorName: m.author?.displayName ?? "Unknown",
        authorAvatarUrl: m.author?.avatarUrl ?? null,
        isSelf: m.isSelf,
        files: m.files,
        reactions: m.reactions,
      }))
    );
    setUserNames(data.userNames);
  }

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
        body: JSON.stringify({ text: resolveMentionsForSend(text) }),
      });
      if (!res.ok) throw new Error("send failed");
      setText("");
      setMentionMap({});
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
        <h1 className="gradient-text truncate text-lg font-bold">{title}</h1>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.map((m) => (
          <div key={m.id} className={`flex items-end gap-2 ${m.isSelf ? "flex-row-reverse" : ""}`}>
            <Avatar seed={m.authorName} name={m.authorName} avatarUrl={m.authorAvatarUrl} />
            <div className={`flex max-w-[75%] flex-col gap-1 ${m.isSelf ? "items-end" : "items-start"}`}>
              {!m.isSelf && (
                <span className="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{m.authorName}</span>
              )}

              {m.text && (
                <div
                  className={
                    m.isSelf
                      ? "btn-primary rounded-2xl rounded-br-sm px-4 py-2 text-white"
                      : "card-surface rounded-2xl rounded-bl-sm px-4 py-2"
                  }
                >
                  <SlackText text={m.text} userNames={userNames} />
                </div>
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
                <button
                  onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                  className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-500 hover:bg-black/[.03] dark:border-white/[.145] dark:text-zinc-400 dark:hover:bg-white/[.05]"
                >
                  +
                </button>

                {pickerFor === m.id && (
                  <div className="card-surface absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-xl p-1">
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
              </div>
            </div>
          </div>
        ))}
      </div>

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
