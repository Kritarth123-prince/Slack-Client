"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Paperclip, Mic, Square, Smile, X } from "lucide-react";
import { useDraft } from "@/hooks/useDraft";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useClickOutside } from "@/hooks/useClickOutside";
import { EmojiPicker } from "@/components/composer/EmojiPicker";
import type { EmojiEntry } from "@/lib/ui/emoji";
import type { Member } from "@/types/chat";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** A file picked or recorded but not yet sent — lets the user preview/play it and back out before it goes anywhere. */
function PendingAttachment({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const isAudio = file.type.startsWith("audio/");
  const isImage = file.type.startsWith("image/");

  return (
    <div className="card-surface flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a static/remote asset
        <img src={url} alt={file.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      )}
      {isAudio ? (
        <audio controls src={url} className="h-8 min-w-0 flex-1" />
      ) : (
        <span className="min-w-0 flex-1 truncate">{isImage ? file.name : `📎 ${file.name}`}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        title="Remove"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Composer({
  conversationId,
  threadTs,
  members,
  ensureMembersLoaded,
  placeholder = "Message... (type @ to mention someone)",
  onSent,
}: {
  conversationId: string;
  threadTs?: string;
  members: Member[];
  ensureMembersLoaded: () => void;
  placeholder?: string;
  onSent: () => void;
}) {
  const { text, setText, clear } = useDraft(conversationId, threadTs);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder();
  const emojiPopoverRef = useClickOutside<HTMLDivElement>(emojiOpen, () => setEmojiOpen(false));

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

  function insertEmoji(entry: EmojiEntry) {
    setEmojiOpen(false);
    const input = inputRef.current;
    const caret = input?.selectionStart ?? text.length;
    setText(text.slice(0, caret) + entry.glyph + text.slice(caret));
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

  function handleFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleMicClick() {
    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (blob) {
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${extension}`, { type: blob.type });
        setPendingFiles((prev) => [...prev, file]);
      }
      return;
    }
    await recorder.start();
  }

  async function sendPendingFiles() {
    setSending(true);
    setError(null);
    try {
      // All pending files go in one request so Slack posts them as a single message with the caption.
      const form = new FormData();
      for (const file of pendingFiles) form.append("file", file);
      if (threadTs) form.append("threadTs", threadTs);
      if (text.trim()) form.append("initialComment", text.trim());

      const res = await fetch(`/api/conversations/${conversationId}/files`, { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        if (body?.error === "missing_scope") {
          throw new Error(body.message ?? "Reconnect your Slack account to enable uploads.");
        }
        if (body?.error === "file_too_large") throw new Error("Those files are too large — 25 MB max per message.");
        if (body?.error === "too_many_files") throw new Error("You can attach up to 10 files per message.");
        throw new Error("upload failed");
      }
      setPendingFiles([]);
      clear();
      onSent();
    } catch (err) {
      setError(err instanceof Error && err.message !== "upload failed" ? err.message : "Couldn't send that. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: resolveMentionsForSend(text), threadTs }),
      });
      if (!res.ok) throw new Error("send failed");
      setMentionMap({});
      clear();
      onSent();
    } catch {
      setError("Couldn't send that message. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    if (pendingFiles.length > 0) {
      await sendPendingFiles();
      return;
    }
    if (!text.trim()) return;
    await sendText();
  }

  const canSend = pendingFiles.length > 0 || text.trim().length > 0;

  return (
    <div>
      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {pendingFiles.map((file, i) => (
            <PendingAttachment key={`${file.name}-${file.lastModified}-${i}`} file={file} onRemove={() => removePendingFile(i)} />
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="relative flex items-center gap-1 sm:gap-2">
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <ul className="card-surface absolute bottom-full mb-1 w-64 max-w-[85vw] rounded-xl">
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
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilePicked}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || recorder.isRecording}
          aria-label="Attach files"
          title="Attach files"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] disabled:opacity-40 sm:h-9 sm:w-9 dark:text-zinc-400 dark:hover:bg-white/[.06]"
        >
          <Paperclip size={17} />
        </button>

        <div ref={emojiPopoverRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Insert emoji"
            title="Insert emoji"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] sm:h-9 sm:w-9 dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            <Smile size={17} />
          </button>
          {emojiOpen && <EmojiPicker onPick={insertEmoji} />}
        </div>

        {recorder.isRecording ? (
          <div className="card-surface flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-2 text-sm sm:px-4">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
            <span className="truncate text-zinc-600 dark:text-zinc-300">
              Recording… {formatElapsed(recorder.elapsedMs)}
            </span>
            <button type="button" onClick={recorder.cancel} className="ml-auto shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
              Cancel
            </button>
          </div>
        ) : (
          <input
            ref={inputRef}
            value={text}
            onChange={handleTextChange}
            placeholder={pendingFiles.length > 0 ? "Add a caption… (optional)" : placeholder}
            className="card-surface min-w-0 flex-1 rounded-full px-3 py-2 text-black outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] sm:px-4 dark:text-zinc-50"
          />
        )}

        <button
          type="button"
          onClick={handleMicClick}
          disabled={sending}
          aria-label={recorder.isRecording ? "Stop recording" : "Record a voice note"}
          title={recorder.isRecording ? "Stop recording" : "Record a voice note"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40 sm:h-9 sm:w-9 ${
            recorder.isRecording
              ? "btn-primary text-white"
              : "text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          }`}
        >
          {recorder.isRecording ? <Square size={15} /> : <Mic size={17} />}
        </button>

        {!recorder.isRecording && (
          <button
            type="submit"
            disabled={sending || !canSend}
            className="btn-primary shrink-0 rounded-full px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:px-5"
          >
            Send
          </button>
        )}
      </form>

      {(error || recorder.error) && <p className="mt-2 text-sm text-red-500">{error ?? recorder.error}</p>}
    </div>
  );
}
