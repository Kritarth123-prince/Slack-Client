"use client";

import { useState } from "react";
import { SlackText } from "@/lib/slack/formatSlackText";
import { emojiGlyph } from "@/lib/ui/emoji";
import { EmojiGlyph, ReactionEmoji } from "@/lib/ui/EmojiGlyph";
import { VoiceTranscript } from "@/components/conversation/VoiceTranscript";
import { useRouter } from "next/navigation";
import { avatarGradient, initials } from "@/lib/ui/avatar";
import { EmojiPicker } from "@/components/composer/EmojiPicker";
import { LinkPreviewCard } from "@/components/conversation/LinkPreviewCard";
import { useClickOutside } from "@/hooks/useClickOutside";
import { firstLinkIn } from "@/lib/slack/links";
import type { EmojiEntry } from "@/lib/ui/emoji";
import type { ForwardTarget, MessageView } from "@/types/chat";
import type { SlackFileView } from "@/lib/slack/messageFiles";

const QUICK_REACTIONS = ["+1", "heart", "joy", "tada", "eyes", "white_check_mark"];

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

  if (file.isAudio) {
    return (
      <div className="mt-2 flex max-w-xs flex-col gap-1 rounded-xl border border-black/[.08] bg-white/60 px-3 py-2 text-sm shadow-sm dark:border-white/[.145] dark:bg-black/20">
        <span className="truncate font-medium">🎤 {file.name}</span>
        <audio controls src={file.proxyUrl} className="w-full" />
        <VoiceTranscript fileId={file.id} proxyUrl={file.proxyUrl} />
      </div>
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

export function MessageBubble({
  message: m,
  userNames,
  context,
  replyCount = 0,
  seenBy = [],
  onOpenThread,
  onReply,
  onToggleReaction,
  onSaveEdit,
  onDelete,
  onTogglePin,
  onToggleSave,
  forwardTargets,
  ensureForwardTargetsLoaded,
  onForwardTo,
  onMarkUnread,
}: {
  message: MessageView;
  userNames: Record<string, string>;
  context: "feed" | "thread";
  replyCount?: number;
  seenBy?: string[];
  onOpenThread?: (rootTs: string) => void;
  onMarkUnread?: (message: MessageView) => void;
  onReply: (message: MessageView) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSaveEdit: (messageId: string, text: string) => void;
  onDelete: (messageId: string) => void;
  onTogglePin: (message: MessageView) => void;
  onToggleSave: (message: MessageView) => void;
  forwardTargets: ForwardTarget[] | null;
  ensureForwardTargetsLoaded: () => void;
  onForwardTo: (messageId: string, targetConversationId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fullPickerOpen, setFullPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindOptions, setRemindOptions] = useState<{ label: string; time: number }[]>([]);
  const [remindStatus, setRemindStatus] = useState<string | null>(null);
  const [customRemindAt, setCustomRemindAt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState(m.text);
  const router = useRouter();

  function closePopovers() {
    setPickerOpen(false);
    setFullPickerOpen(false);
    setMenuOpen(false);
    setForwardOpen(false);
    setRemindOpen(false);
  }

  const popoversRef = useClickOutside<HTMLDivElement>(
    pickerOpen || menuOpen || forwardOpen || remindOpen,
    closePopovers
  );

  async function remindAt(time: number | string) {
    setRemindStatus("Setting…");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: m.id, time }),
      });
      if (res.ok) {
        setRemindStatus("Reminder set ✓");
        setTimeout(() => {
          setRemindOpen(false);
          setRemindStatus(null);
        }, 900);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === "missing_scope") {
        setRemindStatus("Reconnect Slack to enable reminders.");
        setTimeout(() => router.push("/app/settings"), 1500);
      } else {
        setRemindStatus("Couldn't set that reminder.");
      }
    } catch {
      setRemindStatus("Couldn't set that reminder.");
    }
  }

  function remindPresets(): { label: string; time: number }[] {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
    nextWeek.setHours(9, 0, 0, 0);
    return [
      { label: "In 20 minutes", time: Math.floor(now.getTime() / 1000) + 20 * 60 },
      { label: "In 1 hour", time: Math.floor(now.getTime() / 1000) + 60 * 60 },
      { label: "In 3 hours", time: Math.floor(now.getTime() / 1000) + 3 * 60 * 60 },
      { label: "Tomorrow at 09:00", time: Math.floor(tomorrow.getTime() / 1000) },
      { label: "Next Monday at 09:00", time: Math.floor(nextWeek.getTime() / 1000) },
    ];
  }
  const previewUrl = m.isDeleted ? null : firstLinkIn(m.text);

  function pickReaction(entry: EmojiEntry) {
    onToggleReaction(m.id, entry.name);
    closePopovers();
  }

  function startEdit() {
    closePopovers();
    setEditingText(m.text);
    setIsEditing(true);
  }

  function saveEdit() {
    const text = editingText.trim();
    if (!text) return;
    onSaveEdit(m.id, text);
    setIsEditing(false);
  }

  function openForward() {
    setMenuOpen(false);
    setForwardOpen(true);
    ensureForwardTargetsLoaded();
  }

  return (
    <div
      id={`message-${m.id}`}
      className={`group flex items-end gap-2 ${m.isSelf ? "flex-row-reverse" : ""}`}
    >
      <Avatar seed={m.authorName} name={m.authorName} avatarUrl={m.authorAvatarUrl} />
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[75%] ${m.isSelf ? "items-end" : "items-start"}`}>
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

        {m.forwardedFrom && (
          <div className="max-w-full rounded-lg border-l-2 border-zinc-300 bg-black/[.02] px-2 py-1 text-xs text-zinc-500 dark:border-zinc-600 dark:bg-white/[.03] dark:text-zinc-400">
            ↪ Forwarded from <span className="font-medium">{m.forwardedFrom.authorName}</span>
          </div>
        )}

        {isEditing ? (
          <div className="flex w-full flex-col gap-1">
            <input
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") setIsEditing(false);
              }}
              autoFocus
              className="card-surface w-full rounded-xl px-3 py-1.5 text-sm text-black outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] dark:text-zinc-50"
            />
            <div className="flex gap-2 px-1 text-xs">
              <button onClick={saveEdit} className="font-semibold text-[var(--brand-from)]">
                Save
              </button>
              <button onClick={() => setIsEditing(false)} className="text-zinc-500 dark:text-zinc-400">
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

        {previewUrl && <LinkPreviewCard url={previewUrl} />}

        {seenBy.length > 0 && (
          <span className="px-1 text-[10px] text-zinc-400 dark:text-zinc-500" title="Seen by people using this app">
            ✓ Seen by {seenBy.join(", ")}
          </span>
        )}

        {m.files.map((file) => (
          <FileAttachment key={file.id} file={file} />
        ))}

        <div ref={popoversRef} className="relative flex flex-wrap items-center gap-1">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => onToggleReaction(m.id, r.emoji)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                r.reactedByMe
                  ? "border-[var(--brand-from)] bg-[color-mix(in_srgb,var(--brand-from)_12%,transparent)]"
                  : "border-black/[.08] hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
              }`}
            >
              <ReactionEmoji name={r.emoji} /> {r.count}
            </button>
          ))}
          {!m.isDeleted && (
            <button
              onClick={() => {
                setFullPickerOpen(false);
                setPickerOpen((v) => !v);
                setMenuOpen(false);
              }}
              className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-500 hover:bg-black/[.03] dark:border-white/[.145] dark:text-zinc-400 dark:hover:bg-white/[.05]"
            >
              +
            </button>
          )}
          {!m.isDeleted && (
            <button
              onClick={() => {
                setPickerOpen(false);
                setMenuOpen((v) => !v);
              }}
              className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-500 hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
              aria-label="More actions"
            >
              ⋯
            </button>
          )}

          {context === "feed" && replyCount > 0 && (
            <button
              onClick={() => onOpenThread?.(m.threadTs && m.threadTs !== m.slackTs ? m.threadTs : m.slackTs)}
              className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs font-medium text-[var(--brand-from)] hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
            >
              💬 {replyCount} {replyCount === 1 ? "reply" : "replies"}
            </button>
          )}

          {pickerOpen && (
            <div
              className={`card-surface absolute bottom-full z-10 mb-1 flex max-w-[85vw] flex-col gap-1 rounded-xl p-1 ${
                m.isSelf ? "right-0" : "left-0"
              }`}
            >
              {fullPickerOpen ? (
                <EmojiPicker onPick={pickReaction} align={m.isSelf ? "right" : "left"} />
              ) : (
                <div className="flex gap-1">
                  {QUICK_REACTIONS.map((name) => (
                    <button
                      key={name}
                      onClick={() => {
                        onToggleReaction(m.id, name);
                        closePopovers();
                      }}
                      className="rounded-lg p-1 text-base hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                    >
                      <EmojiGlyph glyph={emojiGlyph(name)} />
                    </button>
                  ))}
                  <button
                    onClick={() => setFullPickerOpen(true)}
                    title="More emoji"
                    className="rounded-lg px-1.5 text-base text-zinc-500 hover:bg-black/[.04] dark:text-zinc-400 dark:hover:bg-white/[.05]"
                  >
                    …
                  </button>
                </div>
              )}
            </div>
          )}

          {menuOpen && (
            <div
              className={`card-surface absolute bottom-full z-10 mb-1 flex w-40 max-w-[85vw] flex-col overflow-hidden rounded-xl py-1 text-sm ${
                m.isSelf ? "right-0" : "left-0"
              }`}
            >
              {context === "feed" && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onReply(m);
                  }}
                  className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  💬 Reply in thread
                </button>
              )}
              {m.isSelf && (
                <button onClick={startEdit} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                  ✏️ Edit
                </button>
              )}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onTogglePin(m);
                }}
                className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
              >
                📌 {m.pinned ? "Unpin" : "Pin"}
              </button>
              <button onClick={openForward} className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]">
                ↪️ Forward
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onToggleSave(m);
                }}
                className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
              >
                🔖 {m.savedByMe ? "Unsave" : "Save for later"}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRemindOptions(remindPresets());
                  setRemindOpen(true);
                }}
                className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
              >
                ⏰ Remind me
              </button>
              {context === "feed" && onMarkUnread && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onMarkUnread(m);
                  }}
                  className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  ✉️ Mark unread from here
                </button>
              )}
              {m.isSelf && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(m.id);
                  }}
                  className="px-3 py-1.5 text-left text-red-500 hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  🗑️ Delete
                </button>
              )}
            </div>
          )}

          {remindOpen && (
            <div
              className={`card-surface absolute bottom-full z-20 mb-1 flex w-60 max-w-[85vw] flex-col rounded-xl py-1 text-sm ${
                m.isSelf ? "right-0" : "left-0"
              }`}
            >
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                ⏰ Remind me about this
              </div>
              {remindOptions.map((p) => (
                <button
                  key={p.label}
                  onClick={() => remindAt(p.time)}
                  className="px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  {p.label}
                </button>
              ))}
              <div className="flex items-center gap-1 border-t border-black/[.06] px-3 py-1.5 dark:border-white/[.08]">
                <input
                  type="datetime-local"
                  value={customRemindAt}
                  onChange={(e) => setCustomRemindAt(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-black/[.08] bg-transparent px-1.5 py-1 text-xs dark:border-white/[.145]"
                />
                <button
                  disabled={!customRemindAt}
                  onClick={() => remindAt(Math.floor(new Date(customRemindAt).getTime() / 1000))}
                  className="btn-primary shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Set
                </button>
              </div>
              {remindStatus && <div className="px-3 pb-1.5 text-xs text-zinc-500 dark:text-zinc-400">{remindStatus}</div>}
            </div>
          )}

          {forwardOpen && (
            <div
              className={`card-surface absolute bottom-full z-20 mb-1 flex max-h-56 w-56 max-w-[85vw] flex-col overflow-y-auto rounded-xl py-1 text-sm ${
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
                  onClick={() => {
                    setForwardOpen(false);
                    onForwardTo(m.id, t.id);
                  }}
                  className="truncate px-3 py-1.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.05]"
                >
                  {t.label}
                </button>
              ))}
              <button
                onClick={() => setForwardOpen(false)}
                className="border-t border-black/[.06] px-3 py-1.5 text-left text-zinc-500 dark:border-white/[.08]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
