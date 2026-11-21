"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  AlarmClock,
  Bookmark,
  BookmarkCheck,
  CheckCheck,
  Copy,
  Download,
  EyeOff,
  Forward,
  MessageSquare,
  Mic,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { SlackText } from "@/lib/slack/formatSlackText";
import { emojiGlyph } from "@/lib/ui/emoji";
import { EmojiGlyph, ReactionEmoji } from "@/lib/ui/EmojiGlyph";
import { VoiceTranscript } from "@/components/conversation/VoiceTranscript";
import { FileKindIcon, fileKindLabel } from "@/components/conversation/FileKindIcon";
import { avatarColor, initials } from "@/lib/ui/avatar";
import { EmojiPicker } from "@/components/composer/EmojiPicker";
import { LinkPreviewCard } from "@/components/conversation/LinkPreviewCard";
import { useClickOutside } from "@/hooks/useClickOutside";
import { firstLinkIn } from "@/lib/slack/links";
import { messageDate, formatClock, formatFullDateTime } from "@/lib/slack/messageTime";
import type { EmojiEntry } from "@/lib/ui/emoji";
import type { ForwardTarget, MessageView } from "@/types/chat";
import type { SlackFileView } from "@/lib/slack/messageFiles";

const QUICK_REACTIONS = ["+1", "heart", "joy", "tada", "eyes", "white_check_mark"];
// A popover opened from a message within this distance of the top of the screen opens downwards instead.
const FLIP_BELOW_PX = 340;

function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_CARD = "mt-1 flex w-72 max-w-full flex-col gap-1.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm shadow-sm";

function FileAttachment({ file }: { file: SlackFileView }) {
  const href = file.proxyUrl ?? file.externalUrl ?? "#";

  if (file.kind === "image" && file.proxyUrl) {
    return (
      <a href={file.proxyUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block max-w-xs">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied, dynamic-origin image; next/image would need domain config for our own route */}
        <img src={file.proxyUrl} alt={file.name} className="max-h-80 rounded-xl border border-line object-contain" />
      </a>
    );
  }

  if (file.kind === "audio" && file.proxyUrl) {
    return (
      <div className={FILE_CARD}>
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg">
          <Mic size={14} className="shrink-0 text-subtle" />
          <span className="truncate">{file.name}</span>
        </span>
        <audio controls src={file.proxyUrl} className="h-9 w-full" />
        <VoiceTranscript fileId={file.id} proxyUrl={file.proxyUrl} />
      </div>
    );
  }

  if (file.kind === "video" && file.proxyUrl) {
    return (
      <div className={FILE_CARD}>
        <span className="truncate font-medium text-fg">{file.name}</span>
        <video controls preload="metadata" src={file.proxyUrl} className="w-full rounded-lg" />
      </div>
    );
  }

  // Everything else — PDF, Word, Excel, PowerPoint, archives, code, plain files — gets a typed card.
  const rawExtension = file.name.includes(".") ? file.name.split(".").pop()!.toUpperCase() : file.filetype.toUpperCase();
  // "PDF · PDF" says the same thing twice.
  const extension = rawExtension === fileKindLabel(file.kind).toUpperCase() ? "" : rawExtension;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={file.proxyUrl ? file.name : undefined}
      className={`${FILE_CARD} flex-row items-center gap-3 hover:border-line-strong`}
    >
      <FileKindIcon kind={file.kind} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-fg">{file.name}</span>
        <span className="text-xs text-subtle">
          {fileKindLabel(file.kind)}
          {extension ? ` · ${extension}` : ""}
          {file.size > 0 ? ` · ${formatFileSize(file.size)}` : ""}
          {!file.proxyUrl && file.externalUrl ? " · opens in Slack" : ""}
        </span>
      </span>
      <Download size={16} className="shrink-0 text-subtle" aria-hidden />
    </a>
  );
}

function Avatar({ seed, name, avatarUrl }: { seed: string; name: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Slack CDN URL, not a local/static asset
      <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
    );
  }

  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
      style={{ backgroundColor: avatarColor(seed) }}
    >
      {initials(name)}
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm ${
        danger ? "text-danger hover:bg-danger-soft" : "text-fg hover:bg-surface-2"
      }`}
    >
      <span className={`shrink-0 ${danger ? "" : "text-subtle"}`}>{icon}</span>
      {children}
    </button>
  );
}

export function MessageBubble({
  message: m,
  userNames,
  context,
  continuation = false,
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
  onNotice,
}: {
  message: MessageView;
  userNames: Record<string, string>;
  context: "feed" | "thread";
  /** Same sender a few minutes after the previous message: no avatar or name, tucked up under it. */
  continuation?: boolean;
  replyCount?: number;
  seenBy?: string[];
  onOpenThread?: (rootTs: string) => void;
  onMarkUnread?: (message: MessageView) => void;
  onReply: (message: MessageView) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onSaveEdit: (messageId: string, text: string) => void;
  onDelete: (message: MessageView) => void;
  onTogglePin: (message: MessageView) => void;
  onToggleSave: (message: MessageView) => void;
  forwardTargets: ForwardTarget[] | null;
  ensureForwardTargetsLoaded: () => void;
  onForwardTo: (messageId: string, targetConversationId: string) => void;
  onNotice?: (text: string) => void;
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
  const [placeBelow, setPlaceBelow] = useState(false);
  // On touch screens there's no hover, so tapping a message reveals its actions instead.
  const [touchActive, setTouchActive] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const anyPopoverOpen = pickerOpen || menuOpen || forwardOpen || remindOpen;

  function closePopovers() {
    setPickerOpen(false);
    setFullPickerOpen(false);
    setMenuOpen(false);
    setForwardOpen(false);
    setRemindOpen(false);
  }

  const containerRef = useClickOutside<HTMLDivElement>(anyPopoverOpen || touchActive, () => {
    closePopovers();
    setTouchActive(false);
  });

  /** Opens one popover, choosing up or down by where the message sits on screen. */
  function openPopover(which: "picker" | "menu") {
    const top = toolbarRef.current?.getBoundingClientRect().top ?? Infinity;
    setPlaceBelow(top < FLIP_BELOW_PX);
    const wasOpen = which === "picker" ? pickerOpen : menuOpen;
    closePopovers();
    if (!wasOpen) {
      if (which === "picker") setPickerOpen(true);
      else setMenuOpen(true);
    }
  }

  async function remindAt(time: number | string) {
    setRemindStatus("Setting…");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: m.id, time }),
      });
      if (res.ok) {
        closePopovers();
        setRemindStatus(null);
        onNotice?.("Reminder set — Slackbot will remind you.");
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
  const sentAt = messageDate(m.slackTs);
  const rootTs = m.threadTs && m.threadTs !== m.slackTs ? m.threadTs : m.slackTs;

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
    if (text !== m.text) onSaveEdit(m.id, text);
    setIsEditing(false);
  }

  async function copyText() {
    closePopovers();
    try {
      await navigator.clipboard.writeText(m.text);
      onNotice?.("Copied to clipboard");
    } catch {
      onNotice?.("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  function run(action: () => void) {
    return () => {
      closePopovers();
      action();
    };
  }

  const popoverPosition = `${placeBelow ? "top-full mt-1" : "bottom-full mb-1"} ${m.isSelf ? "left-0" : "right-0"}`;
  const toolbarVisible = anyPopoverOpen || touchActive;

  const timeLabel = (
    <time
      dateTime={sentAt.toISOString()}
      title={formatFullDateTime(sentAt)}
      suppressHydrationWarning
      className="text-[11px] tabular-nums text-subtle"
    >
      {formatClock(sentAt)}
    </time>
  );

  return (
    <div
      ref={containerRef}
      id={`message-${m.id}`}
      data-continuation={continuation}
      className={`group/msg relative flex gap-2.5 rounded-xl px-1 ${m.isSelf ? "flex-row-reverse" : ""}`}
    >
      {continuation ? (
        // Keeps the column aligned with the avatar above; shows the time on hover instead of a header.
        <div className="flex w-8 shrink-0 items-center justify-center opacity-0 group-hover/msg:opacity-100">
          <span className="text-[10px] tabular-nums text-subtle" suppressHydrationWarning>
            {formatClock(sentAt)}
          </span>
        </div>
      ) : (
        <Avatar seed={m.authorId ?? m.authorName} name={m.authorName} avatarUrl={m.authorAvatarUrl} />
      )}

      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[72%] ${m.isSelf ? "items-end" : "items-start"}`}>
        {!continuation && (
          <div className={`flex items-baseline gap-1.5 px-0.5 ${m.isSelf ? "flex-row-reverse" : ""}`}>
            <span className="text-[13px] font-semibold text-fg">{m.isSelf ? "You" : m.authorName}</span>
            {timeLabel}
            {m.pinned && <Pin size={11} className="self-center text-warning" aria-label="Pinned" />}
          </div>
        )}

        {m.forwardedFrom && !m.isDeleted && (
          <div className="flex items-center gap-1 px-0.5 text-xs text-subtle">
            <Forward size={12} /> Forwarded from <span className="font-medium text-muted">{m.forwardedFrom.authorName}</span>
          </div>
        )}

        {isEditing ? (
          <div className="flex w-full min-w-[16rem] flex-col gap-1.5">
            <textarea
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") setIsEditing(false);
              }}
              rows={Math.min(6, editingText.split("\n").length + 1)}
              autoFocus
              className="w-full resize-none rounded-xl border border-accent bg-surface px-3 py-2 text-[15px] text-fg outline-none ring-2 ring-[var(--accent-soft)]"
            />
            <div className="flex items-center justify-end gap-1.5 text-xs">
              <span className="mr-auto text-subtle">Enter to save · Esc to cancel</span>
              <button type="button" onClick={() => setIsEditing(false)} className="h-7 rounded-md px-2.5 text-muted hover:bg-surface-2">
                Cancel
              </button>
              <button type="button" onClick={saveEdit} className="btn-primary h-7 rounded-md px-2.5 font-semibold">
                Save
              </button>
            </div>
          </div>
        ) : m.isDeleted ? (
          <div className="rounded-2xl border border-dashed border-line px-3.5 py-2 text-sm italic text-subtle">
            This message was deleted.
          </div>
        ) : (
          m.text && (
            <div
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a, button")) return;
                if (window.matchMedia("(pointer: coarse)").matches) setTouchActive((v) => !v);
              }}
              className={`px-3.5 py-2 text-[15px] leading-relaxed ${
                m.isSelf
                  ? `bubble-self rounded-2xl bg-accent text-accent-fg ${continuation ? "" : "rounded-tr-md"}`
                  : `rounded-2xl border border-line bg-surface text-fg shadow-sm ${continuation ? "" : "rounded-tl-md"}`
              }`}
            >
              <SlackText text={m.text} userNames={userNames} />
              {m.isEdited && <span className="ml-1 text-[11px] opacity-70">(edited)</span>}
            </div>
          )
        )}

        {previewUrl && <LinkPreviewCard url={previewUrl} />}

        {!m.isDeleted && m.files.map((file) => <FileAttachment key={file.id} file={file} />)}

        {!m.isDeleted && m.reactions.length > 0 && (
          <div className={`flex flex-wrap items-center gap-1 ${m.isSelf ? "justify-end" : ""}`}>
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onToggleReaction(m.id, r.emoji)}
                aria-pressed={r.reactedByMe}
                title={`:${r.emoji}:`}
                className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums ${
                  r.reactedByMe
                    ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-accent-soft font-medium text-accent-text"
                    : "border-line bg-surface text-muted hover:border-line-strong"
                }`}
              >
                <ReactionEmoji name={r.emoji} /> {r.count}
              </button>
            ))}
          </div>
        )}

        {context === "feed" && replyCount > 0 && (
          <button
            type="button"
            onClick={() => onOpenThread?.(rootTs)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold text-accent-text hover:bg-accent-soft"
          >
            <MessageSquare size={13} />
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {seenBy.length > 0 && (
          <span className="flex items-center gap-1 px-0.5 text-[11px] text-subtle" title="Seen by people using this app">
            <CheckCheck size={12} /> Seen by {seenBy.join(", ")}
          </span>
        )}
      </div>

      {!m.isDeleted && !isEditing && (
        <div
          ref={toolbarRef}
          className={`absolute -top-3.5 z-10 ${m.isSelf ? "left-1" : "right-1"} ${
            toolbarVisible ? "visible" : "invisible group-hover/msg:visible group-focus-within/msg:visible"
          }`}
        >
          <div className="popover-surface flex items-center gap-px rounded-lg p-0.5" role="toolbar" aria-label="Message actions">
            <ToolbarButton label="Add reaction" onClick={() => openPopover("picker")}>
              <SmilePlus size={15} />
            </ToolbarButton>
            {context === "feed" && (
              <ToolbarButton label="Reply in thread" onClick={run(() => onReply(m))}>
                <MessageSquare size={15} />
              </ToolbarButton>
            )}
            <ToolbarButton label={m.savedByMe ? "Remove from saved" : "Save for later"} onClick={run(() => onToggleSave(m))}>
              {m.savedByMe ? <BookmarkCheck size={15} className="text-accent-text" /> : <Bookmark size={15} />}
            </ToolbarButton>
            <ToolbarButton label="More actions" onClick={() => openPopover("menu")}>
              <MoreHorizontal size={15} />
            </ToolbarButton>
          </div>

          {pickerOpen &&
            (fullPickerOpen ? (
              <EmojiPicker onPick={pickReaction} align={m.isSelf ? "left" : "right"} placement={placeBelow ? "below" : "above"} />
            ) : (
              <div className={`popover-surface absolute z-20 flex items-center gap-0.5 rounded-xl p-1 ${popoverPosition}`}>
                {QUICK_REACTIONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    title={`:${name}:`}
                    onClick={() => {
                      onToggleReaction(m.id, name);
                      closePopovers();
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-surface-2"
                  >
                    <EmojiGlyph glyph={emojiGlyph(name)} />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFullPickerOpen(true)}
                  title="More emoji"
                  aria-label="More emoji"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
                >
                  <SmilePlus size={16} />
                </button>
              </div>
            ))}

          {menuOpen && (
            <div role="menu" className={`popover-surface absolute z-20 flex w-56 max-w-[85vw] flex-col rounded-xl p-1 ${popoverPosition}`}>
              {context === "feed" && (
                <MenuItem icon={<MessageSquare size={15} />} onClick={run(() => onReply(m))}>
                  Reply in thread
                </MenuItem>
              )}
              {m.text && (
                <MenuItem icon={<Copy size={15} />} onClick={copyText}>
                  Copy text
                </MenuItem>
              )}
              {m.isSelf && (
                <MenuItem icon={<Pencil size={15} />} onClick={startEdit}>
                  Edit message
                </MenuItem>
              )}
              <MenuItem icon={m.pinned ? <PinOff size={15} /> : <Pin size={15} />} onClick={run(() => onTogglePin(m))}>
                {m.pinned ? "Unpin from conversation" : "Pin to conversation"}
              </MenuItem>
              <MenuItem
                icon={<Forward size={15} />}
                onClick={() => {
                  setMenuOpen(false);
                  setForwardOpen(true);
                  ensureForwardTargetsLoaded();
                }}
              >
                Forward…
              </MenuItem>
              <MenuItem
                icon={<AlarmClock size={15} />}
                onClick={() => {
                  setMenuOpen(false);
                  setRemindOptions(remindPresets());
                  setRemindStatus(null);
                  setRemindOpen(true);
                }}
              >
                Remind me about this…
              </MenuItem>
              {context === "feed" && onMarkUnread && (
                <MenuItem icon={<EyeOff size={15} />} onClick={run(() => onMarkUnread(m))}>
                  Mark unread from here
                </MenuItem>
              )}
              {m.isSelf && (
                <>
                  <div className="my-1 border-t border-line" />
                  <MenuItem icon={<Trash2 size={15} />} danger onClick={run(() => onDelete(m))}>
                    Delete message…
                  </MenuItem>
                </>
              )}
            </div>
          )}

          {remindOpen && (
            <div className={`popover-surface absolute z-20 flex w-64 max-w-[85vw] flex-col rounded-xl p-1 text-sm ${popoverPosition}`}>
              <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">Remind me</p>
              {remindOptions.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => remindAt(p.time)}
                  className="flex h-8 items-center rounded-md px-2 text-left text-fg hover:bg-surface-2"
                >
                  {p.label}
                </button>
              ))}
              <div className="mt-1 flex items-center gap-1.5 border-t border-line px-1 pt-2 pb-1">
                <input
                  type="datetime-local"
                  value={customRemindAt}
                  onChange={(e) => setCustomRemindAt(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 text-xs text-fg"
                />
                <button
                  type="button"
                  disabled={!customRemindAt}
                  onClick={() => remindAt(Math.floor(new Date(customRemindAt).getTime() / 1000))}
                  className="btn-primary h-8 shrink-0 rounded-md px-2.5 text-xs font-semibold disabled:opacity-50"
                >
                  Set
                </button>
              </div>
              {remindStatus && <p className="px-2 pb-1.5 text-xs text-subtle">{remindStatus}</p>}
            </div>
          )}

          {forwardOpen && (
            <div className={`popover-surface absolute z-20 flex max-h-64 w-60 max-w-[85vw] flex-col overflow-y-auto rounded-xl p-1 text-sm ${popoverPosition}`}>
              <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-subtle">Forward to…</p>
              {forwardTargets === null && <p className="px-2 py-1.5 text-subtle">Loading…</p>}
              {forwardTargets?.length === 0 && <p className="px-2 py-1.5 text-subtle">No conversations</p>}
              {forwardTargets?.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setForwardOpen(false);
                    onForwardTo(m.id, t.id);
                  }}
                  className="flex h-8 shrink-0 items-center truncate rounded-md px-2 text-left text-fg hover:bg-surface-2"
                >
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
