"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { SlackText } from "@/lib/slack/formatSlackText";
import type { SlackFileView } from "@/lib/slack/messageFiles";

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
  author: { displayName: string } | null;
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
        <img src={file.proxyUrl} alt={file.name} className="rounded-lg border border-black/[.08] dark:border-white/[.145]" />
      </a>
    );
  }

  return (
    <a
      href={file.proxyUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-xs flex-col gap-0.5 rounded-lg border border-black/[.08] px-3 py-2 text-sm hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
    >
      <span className="truncate font-medium">{file.name}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {file.filetype.toUpperCase()} {formatFileSize(file.size)}
      </span>
    </a>
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
      <h1 className="mb-4 text-lg font-semibold text-black dark:text-zinc-50">{title}</h1>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className="rounded-lg bg-black/[.03] px-3 py-2 dark:bg-white/[.05]">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{m.authorName}</div>
            {m.text && (
              <div className="text-black dark:text-zinc-50">
                <SlackText text={m.text} userNames={userNames} />
              </div>
            )}
            {m.files.map((file) => (
              <FileAttachment key={file.id} file={file} />
            ))}

            <div className="relative mt-1 flex flex-wrap items-center gap-1">
              {m.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => toggleReaction(m.id, r.emoji)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    r.reactedByMe
                      ? "border-blue-500 bg-blue-500/10"
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
                <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-lg border border-black/[.08] bg-white p-1 shadow-lg dark:border-white/[.145] dark:bg-zinc-900">
                  {QUICK_REACTIONS.map((name) => (
                    <button
                      key={name}
                      onClick={() => toggleReaction(m.id, name)}
                      className="rounded p-1 text-base hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                    >
                      {emojiGlyph(name)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="relative mt-4 flex gap-2">
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <ul className="absolute bottom-full mb-1 w-64 rounded-lg border border-black/[.08] bg-white shadow-lg dark:border-white/[.145] dark:bg-zinc-900">
            {filteredMembers.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => selectMention(m)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.05]"
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
          className="flex-1 rounded-full border border-black/[.08] px-4 py-2 text-black dark:border-white/[.145] dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={sending}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
