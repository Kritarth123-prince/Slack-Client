"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Paperclip, Mic, Square, Smile, X, Bold, Italic, Strikethrough, Code, Quote, Clock } from "lucide-react";
import { useDraft } from "@/hooks/useDraft";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useClickOutside } from "@/hooks/useClickOutside";
import { EmojiPicker } from "@/components/composer/EmojiPicker";
import type { EmojiEntry } from "@/lib/ui/emoji";
import type { Member } from "@/types/chat";

const TYPING_PING_INTERVAL_MS = 3000;
const MAX_TEXTAREA_PX = 200;

type Format = "bold" | "italic" | "strike" | "code" | "quote";
const TOOLBAR: { Icon: typeof Bold; label: string; format: Format }[] = [
  { Icon: Bold, label: "Bold (Ctrl+B)", format: "bold" },
  { Icon: Italic, label: "Italic (Ctrl+I)", format: "italic" },
  { Icon: Strikethrough, label: "Strikethrough (Ctrl+Shift+X)", format: "strike" },
  { Icon: Code, label: "Code (Ctrl+E)", format: "code" },
  { Icon: Quote, label: "Quote (Ctrl+Shift+.)", format: "quote" },
];

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function schedulePresets(): { label: string; at: Date }[] {
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60_000);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextMonday = new Date(now);
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
  nextMonday.setHours(9, 0, 0, 0);
  return [
    { label: "In 1 hour", at: inOneHour },
    { label: "Tomorrow at 09:00", at: tomorrow },
    { label: "Next Monday at 09:00", at: nextMonday },
  ];
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

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/[.04] disabled:opacity-40 sm:h-9 sm:w-9 dark:text-zinc-400 dark:hover:bg-white/[.06]";

export function Composer({
  conversationId,
  threadTs,
  members,
  ensureMembersLoaded,
  placeholder = "Message… (Enter to send, Shift+Enter for a new line)",
  onSent,
  onScheduled,
  attachRef,
}: {
  conversationId: string;
  threadTs?: string;
  members: Member[];
  ensureMembersLoaded: () => void;
  placeholder?: string;
  onSent: () => void;
  onScheduled?: () => void;
  /** Lets the surrounding view hand in files (drag-and-drop onto the conversation) without owning composer state. */
  attachRef?: RefObject<ComposerHandle | null>;
}) {
  const { text, setText, clear } = useDraft(conversationId, threadTs);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Times are computed when the popover opens (an event), not during render.
  const [scheduleOptions, setScheduleOptions] = useState<{ label: string; at: Date }[]>([]);
  const [customTime, setCustomTime] = useState("");
  const [minTime, setMinTime] = useState("");

  function toggleSchedule() {
    if (!scheduleOpen) {
      const now = new Date();
      setScheduleOptions(schedulePresets());
      setMinTime(toLocalDatetimeInput(now));
      setCustomTime((v) => v || toLocalDatetimeInput(new Date(now.getTime() + 60 * 60_000)));
    }
    setScheduleOpen((v) => !v);
  }
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder = useAudioRecorder();
  const emojiPopoverRef = useClickOutside<HTMLDivElement>(emojiOpen, () => setEmojiOpen(false));
  const schedulePopoverRef = useClickOutside<HTMLDivElement>(scheduleOpen, () => setScheduleOpen(false));

  function addFiles(files: File[]) {
    if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
  }

  useEffect(() => {
    if (!attachRef) return;
    attachRef.current = { addFiles };
    return () => {
      attachRef.current = null;
    };
  }, [attachRef]);

  // Auto-grow the textarea with its content, up to a cap, then scroll inside it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  // One heartbeat every few seconds while keys are being pressed — enough for the other side's
  // 4s poll to show "is typing" without a request per keystroke. Sending clears it explicitly.
  const typingThrottledRef = useRef(false);
  function pingTyping(stop = false) {
    if (!stop && typingThrottledRef.current) return;
    typingThrottledRef.current = !stop;
    if (!stop) {
      setTimeout(() => {
        typingThrottledRef.current = false;
      }, TYPING_PING_INTERVAL_MS);
    }
    fetch(`/api/conversations/${conversationId}/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadTs: threadTs ?? "", stop }),
    }).catch(() => {});
  }

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    if (value.trim()) pingTyping();

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

  function replaceSelection(build: (selected: string) => { value: string; caretStart: number; caretEnd: number }) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    const { value, caretStart, caretEnd } = build(text.slice(start, end));
    setText(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + caretStart, start + caretEnd);
    });
  }

  function insertEmoji(entry: EmojiEntry) {
    setEmojiOpen(false);
    // Custom emoji have no glyph — Slack renders `:name:` in text, so that's what gets inserted.
    const inserted = entry.url ? `:${entry.name}:` : entry.glyph;
    replaceSelection(() => ({ value: inserted, caretStart: inserted.length, caretEnd: inserted.length }));
  }

  /** Wraps the selection in Slack mrkdwn markers (or inserts an empty pair with the caret inside). */
  function wrapWith(marker: string) {
    replaceSelection((selected) => ({
      value: `${marker}${selected}${marker}`,
      caretStart: marker.length,
      caretEnd: marker.length + selected.length,
    }));
  }

  function quoteSelection() {
    replaceSelection((selected) => {
      const quoted = (selected || "")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      return { value: quoted, caretStart: 2, caretEnd: quoted.length };
    });
  }

  function applyFormat(format: Format) {
    if (format === "bold") wrapWith("*");
    else if (format === "italic") wrapWith("_");
    else if (format === "strike") wrapWith("~");
    else if (format === "code") wrapWith("`");
    else quoteSelection();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      formRef.current?.requestSubmit();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const format: Format | null =
      key === "b" ? "bold" : key === "i" ? "italic" : key === "e" ? "code" : key === "x" && e.shiftKey ? "strike" : key === "." && e.shiftKey ? "quote" : null;
    if (!format) return;
    e.preventDefault();
    applyFormat(format);
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
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
    addFiles(files);
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
        addFiles([file]);
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
      if (text.trim()) form.append("initialComment", resolveMentionsForSend(text.trim()));

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
      setMentionMap({});
      clear();
      pingTyping(true);
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
      pingTyping(true);
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

  async function scheduleFor(at: Date) {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/scheduled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: resolveMentionsForSend(text), postAt: at.toISOString(), threadTs }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "invalid_time") throw new Error("Pick a time at least a minute from now and within 120 days.");
        if (body?.error === "missing_scope") throw new Error("Reconnect your Slack account to schedule messages.");
        throw new Error("schedule failed");
      }
      setScheduleOpen(false);
      setMentionMap({});
      clear();
      pingTyping(true);
      onScheduled?.();
    } catch (err) {
      setError(err instanceof Error && err.message !== "schedule failed" ? err.message : "Couldn't schedule that. Try again.");
    } finally {
      setSending(false);
    }
  }

  const canSend = pendingFiles.length > 0 || text.trim().length > 0;
  const canSchedule = text.trim().length > 0 && pendingFiles.length === 0;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative rounded-2xl transition-shadow ${dragging ? "ring-2 ring-[var(--brand-from)]" : ""}`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--brand-from)_10%,transparent)] text-sm font-medium text-[var(--brand-from)]">
          Drop files to attach
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5">
          {pendingFiles.map((file, i) => (
            <PendingAttachment key={`${file.name}-${file.lastModified}-${i}`} file={file} onRemove={() => removePendingFile(i)} />
          ))}
        </div>
      )}

      <div className="mb-1 hidden items-center gap-0.5 px-1 sm:flex" aria-label="Formatting">
        {TOOLBAR.map(({ Icon, label, format }) => (
          <button
            key={label}
            type="button"
            onClick={() => applyFormat(format)}
            title={label}
            aria-label={label}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.06]"
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <form ref={formRef} onSubmit={handleSend} className="relative flex items-end gap-1 sm:gap-2">
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

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePicked} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || recorder.isRecording}
          aria-label="Attach files"
          title="Attach files (or paste / drop them)"
          className={ICON_BUTTON}
        >
          <Paperclip size={17} />
        </button>

        <div ref={emojiPopoverRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Insert emoji"
            title="Insert emoji"
            className={ICON_BUTTON}
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
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={pendingFiles.length > 0 ? "Add a caption… (optional)" : placeholder}
            className="card-surface min-w-0 flex-1 resize-none rounded-2xl px-3 py-2 text-black outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] sm:px-4 dark:text-zinc-50"
          />
        )}

        <button
          type="button"
          onClick={handleMicClick}
          disabled={sending}
          aria-label={recorder.isRecording ? "Stop recording" : "Record a voice note"}
          title={recorder.isRecording ? "Stop recording" : "Record a voice note"}
          className={`${ICON_BUTTON} ${recorder.isRecording ? "btn-primary text-white hover:bg-transparent" : ""}`}
        >
          {recorder.isRecording ? <Square size={15} /> : <Mic size={17} />}
        </button>

        {!recorder.isRecording && (
          <div ref={schedulePopoverRef} className="relative shrink-0">
            <button
              type="button"
              onClick={toggleSchedule}
              disabled={sending || !canSchedule}
              aria-label="Send later"
              title={canSchedule ? "Send later" : "Type a message to schedule it"}
              className={ICON_BUTTON}
            >
              <Clock size={17} />
            </button>
            {scheduleOpen && (
              <div className="card-surface absolute right-0 bottom-full z-20 mb-1 flex w-64 max-w-[85vw] flex-col gap-1 rounded-xl p-2 text-sm">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Send later
                </p>
                {scheduleOptions.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => scheduleFor(preset.at)}
                    className="rounded-lg px-2 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                  >
                    {preset.label}
                  </button>
                ))}
                <div className="mt-1 flex items-center gap-1 border-t border-black/[.06] pt-2 dark:border-white/[.08]">
                  <input
                    type="datetime-local"
                    value={customTime}
                    min={minTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-black/[.08] bg-transparent px-2 py-1 text-xs dark:border-white/[.145]"
                  />
                  <button
                    type="button"
                    onClick={() => scheduleFor(new Date(customTime))}
                    className="btn-primary shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-white"
                  >
                    Schedule
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

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
