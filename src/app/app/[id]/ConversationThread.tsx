"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { SlackText } from "@/lib/slack/formatSlackText";

export interface MessageView {
  id: string;
  text: string;
  createdAt: string;
  authorName: string;
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
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/conversations/${conversationId}/members`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { members?: Member[] } | null) => {
        if (data?.members) setMembers(data.members);
      })
      .catch(() => {});
  }, [conversationId]);

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
      }))
    );
    setUserNames(data.userNames);
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

      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className="rounded-lg bg-black/[.03] px-3 py-2 dark:bg-white/[.05]">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{m.authorName}</div>
            <div className="text-black dark:text-zinc-50">
              <SlackText text={m.text} userNames={userNames} />
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
