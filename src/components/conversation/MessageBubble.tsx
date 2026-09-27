"use client";

import { useState } from "react";
import { SlackText } from "@/lib/slack/formatSlackText";
import { emojiGlyph } from "@/lib/ui/emoji";
import { EmojiGlyph } from "@/lib/ui/EmojiGlyph";
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
}: {
  message: MessageView;
  userNames: Record<string, string>;
  context: "feed" | "thread";
  replyCount?: number;
  seenBy?: string[];
  onOpenThread?: (rootTs: string) => void;
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
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState(m.text);

  function closePopovers() {
    setPickerOpen(false);
    setFullPickerOpen(false);
    setMenuOpen(false);
    setForwardOpen(false);
  }

  const popoversRef = useClickOutside<HTMLDivElement>(
    pickerOpen || menuOpen || forwardOpen,
    closePopovers
  );
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
              <EmojiGlyph glyph={emojiGlyph(r.emoji)} /> {r.count}
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
