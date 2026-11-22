"use client";

import { useEffect, useState } from "react";
import { BellOff, ChevronsUpDown, Info, Smile, TriangleAlert } from "lucide-react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { EmojiPicker } from "@/components/composer/EmojiPicker";
import { EmojiText } from "@/lib/ui/EmojiGlyph";
import type { EmojiEntry } from "@/lib/ui/emoji";
import type { StatusView } from "@/lib/slack/presence";

// Shortcodes, not glyphs: Slack's profile API only accepts `:name:` for status_emoji.
const STATUS_PRESETS: { emoji: string; text: string; expiry: ExpiryOption }[] = [
  { emoji: ":spiral_calendar_pad:", text: "In a meeting", expiry: "1h" },
  { emoji: ":bus:", text: "Commuting", expiry: "30m" },
  { emoji: ":ramen:", text: "Out for lunch", expiry: "1h" },
  { emoji: ":house:", text: "Working remotely", expiry: "today" },
  { emoji: ":face_with_thermometer:", text: "Off sick", expiry: "today" },
  { emoji: ":palm_tree:", text: "On holiday", expiry: "none" },
];

type ExpiryOption = "none" | "30m" | "1h" | "4h" | "today";

const EXPIRY_LABELS: Record<ExpiryOption, string> = {
  none: "Don't clear",
  "30m": "30 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  today: "Today",
};

const STATUS_POLL_MS = 60_000;

function expiryToDate(option: ExpiryOption): string | null {
  if (option === "none") return null;
  const now = Date.now();
  if (option === "30m") return new Date(now + 30 * 60_000).toISOString();
  if (option === "1h") return new Date(now + 60 * 60_000).toISOString();
  if (option === "4h") return new Date(now + 4 * 60 * 60_000).toISOString();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.toISOString();
}

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? `until ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : `until ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** What colleagues see: Slack's own verdict when we have it, otherwise the user's choice. */
function shownPresence(status: StatusView): "active" | "away" {
  return status.slackPresence ?? status.presence;
}

function PresenceDot({ presence, className = "" }: { presence: "active" | "away"; className?: string }) {
  return presence === "active" ? (
    <span className={`h-2.5 w-2.5 shrink-0 rounded-full bg-success ${className}`} aria-hidden />
  ) : (
    <span className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 border-subtle ${className}`} aria-hidden />
  );
}

export function StatusMenu() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState("");
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("none");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const menuRef = useClickOutside<HTMLDivElement>(open, () => {
    setOpen(false);
    setPickerOpen(false);
  });

  function adopt(data: StatusView, syncFields: boolean) {
    setStatus(data);
    if (syncFields) {
      setEmoji(data.statusEmoji ?? "");
      setText(data.statusText ?? "");
    }
  }

  // Polled (and refreshed when the tab comes back) so a status or Away set in Slack's own apps
  // shows up here too. The draft fields only follow along while the menu is closed.
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: StatusView | null) => {
          if (!cancelled && data) setStatus(data);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, STATUS_POLL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function toggleOpen() {
    if (!open && status) {
      setEmoji(status.statusEmoji ?? "");
      setText(status.statusText ?? "");
      setExpiry("none");
    }
    setPickerOpen(false);
    setOpen((v) => !v);
  }

  async function patch(input: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) adopt((await res.json()) as StatusView, true);
    } catch {
      // transient failure — status just won't update this time
    } finally {
      setSaving(false);
    }
  }

  function applyPreset(preset: (typeof STATUS_PRESETS)[number]) {
    setEmoji(preset.emoji);
    setText(preset.text);
    setExpiry(preset.expiry);
    patch({ statusEmoji: preset.emoji, statusText: preset.text, statusExpiresAt: expiryToDate(preset.expiry) });
  }

  function saveCustomStatus() {
    patch({ statusEmoji: emoji || null, statusText: text || null, statusExpiresAt: expiryToDate(expiry) });
  }

  function clearStatus() {
    setEmoji("");
    setText("");
    setExpiry("none");
    patch({ clearStatus: true });
  }

  function pickEmoji(entry: EmojiEntry) {
    setEmoji(`:${entry.name}:`);
    setPickerOpen(false);
  }

  if (!status) return <div className="h-11" aria-hidden />;

  const presence = shownPresence(status);
  const hasStatus = Boolean(status.statusEmoji || status.statusText);
  // "Active" chosen, but Slack still shows Away: nothing of Slack's own is open, and apps can't
  // mark anyone active — worth saying, or the toggle looks broken.
  const slackKeepsAway = status.presence === "active" && status.slackPresence === "away";
  const draftChanged = emoji !== (status.statusEmoji ?? "") || text !== (status.statusText ?? "") || expiry !== "none";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
      >
        <PresenceDot presence={presence} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-fg">{presence === "active" ? "Active" : "Away"}</span>
          <span className="truncate text-xs text-subtle">
            {hasStatus ? (
              <EmojiText text={`${status.statusEmoji ?? ""} ${status.statusText ?? ""}`.trim()} />
            ) : (
              "Set a status"
            )}
          </span>
        </span>
        {status.doNotDisturb && <BellOff size={14} className="shrink-0 text-subtle" aria-label="Notifications paused" />}
        <ChevronsUpDown size={14} className="shrink-0 text-subtle" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Status"
          className="popover-surface absolute bottom-full left-0 z-30 mb-2 w-[19rem] max-w-[calc(100vw-1rem)] rounded-xl p-3 text-sm"
        >
          {status.slackSyncWarning && (
            <div className="mb-3 flex gap-2 rounded-lg bg-warning-soft px-2.5 py-2 text-xs text-warning">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              <div className="flex flex-col gap-1.5">
                <p>{status.slackSyncWarning}</p>
                <a href="/api/oauth/slack" className="self-start font-semibold underline underline-offset-2">
                  Reconnect Slack
                </a>
              </div>
            </div>
          )}

          <p className="mb-1.5 text-xs font-medium text-subtle">Presence</p>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Presence">
            {(["active", "away"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={status.presence === value}
                disabled={saving}
                onClick={() => patch({ presence: value })}
                className={`flex h-8 items-center justify-center gap-2 rounded-md text-sm font-medium ${
                  status.presence === value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
                }`}
              >
                <PresenceDot presence={value} />
                {value === "active" ? "Automatic" : "Away"}
              </button>
            ))}
          </div>
          <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-subtle">
            <Info size={13} className="mt-0.5 shrink-0" />
            {slackKeepsAway
              ? "Slack shows you as Away because none of Slack's own apps is open. Slack only lets other apps set Away — it decides Active itself."
              : status.presence === "away"
                ? "You appear Away in Slack until you switch back to Automatic."
                : "Slack shows you as Active while one of its apps is open and you're using it."}
          </p>

          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-1.5 text-xs font-medium text-subtle">Status</p>
            <div className="relative flex gap-1.5">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                aria-label="Choose status emoji"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-base hover:bg-surface-2"
              >
                {emoji ? <EmojiText text={emoji} /> : <Smile size={16} className="text-subtle" />}
              </button>
              {pickerOpen && <EmojiPicker onPick={pickEmoji} placement="below" />}
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draftChanged) saveCustomStatus();
                }}
                maxLength={100}
                placeholder="What's your status?"
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-fg outline-none placeholder:text-subtle focus:border-accent"
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {STATUS_PRESETS.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={saving}
                  className="flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs text-muted hover:border-line-strong hover:text-fg"
                >
                  <EmojiText text={p.emoji} /> {p.text}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-subtle">
                Clear after
                <select
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-xs text-fg"
                >
                  {(Object.keys(EXPIRY_LABELS) as ExpiryOption[]).map((option) => (
                    <option key={option} value={option}>
                      {EXPIRY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              {hasStatus && (
                <button type="button" onClick={clearStatus} disabled={saving} className="h-8 rounded-lg px-2 text-xs text-muted hover:bg-surface-2 hover:text-fg">
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={saveCustomStatus}
                disabled={saving || !draftChanged || (!emoji && !text.trim())}
                className="btn-primary h-8 rounded-lg px-3 text-xs font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
            {status.statusExpiresAt && hasStatus && (
              <p className="mt-1.5 text-xs text-subtle">Current status clears {formatExpiry(status.statusExpiresAt)}.</p>
            )}
          </div>

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 border-t border-line pt-3">
            <span>
              <span className="block text-sm text-fg">Pause notifications</span>
              <span className="block text-xs text-subtle">Do Not Disturb in Slack for 24 hours</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={status.doNotDisturb}
              disabled={saving}
              onChange={(e) => patch({ doNotDisturb: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
          </label>
        </div>
      )}
    </div>
  );
}
