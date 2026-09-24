"use client";

import { useState, type FormEvent } from "react";

export interface MessageView {
  id: string;
  text: string;
  createdAt: string;
  authorName: string;
}

interface ApiMessage {
  id: string;
  text: string;
  createdAt: string;
  author: { displayName: string } | null;
}

export function ConversationThread({
  conversationId,
  title,
  initialMessages,
}: {
  conversationId: string;
  title: string;
  initialMessages: MessageView[];
}) {
  const [messages, setMessages] = useState<MessageView[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ApiMessage[] };
    setMessages(
      data.messages.map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.createdAt,
        authorName: m.author?.displayName ?? "Unknown",
      }))
    );
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("send failed");
      setText("");
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
            <div className="text-black dark:text-zinc-50">{m.text}</div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="mt-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message..."
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
