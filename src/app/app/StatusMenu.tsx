"use client";

import { useEffect, useRef, useState } from "react";

interface StatusView {
  presence: "active" | "away";
  presenceManual: boolean;
  autoAwayEnabled: boolean;
  doNotDisturb: boolean;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  slackSyncWarning: string | null;
}

const STATUS_PRESETS: { emoji: string; text: string }[] = [
  { emoji: "🏠", text: "Working from home" },
  { emoji: "🍜", text: "Lunch" },
  { emoji: "🚗", text: "Commuting" },
  { emoji: "🤒", text: "Out sick" },
  { emoji: "🌴", text: "Vacationing" },
  { emoji: "📅", text: "In a meeting" },
];

type ExpiryOption = "none" | "30m" | "1h" | "today";

function expiryToDate(option: ExpiryOption): string | null {
  if (option === "none") return null;
  const now = new Date();
  if (option === "30m") return new Date(now.getTime() + 30 * 60_000).toISOString();
  if (option === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.toISOString();
}

export function StatusMenu() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState("");
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("none");
  const [saving, setSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StatusView | null) => {
        if (!data) return;
        setStatus(data);
        setEmoji(data.statusEmoji ?? "");
        setText(data.statusText ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function patch(input: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) {
        const data = (await res.json()) as StatusView;
        setStatus(data);
        setEmoji(data.statusEmoji ?? "");
        setText(data.statusText ?? "");
      }
    } catch {
      // transient failure — status just won't update this time
    } finally {
      setSaving(false);
    }
  }

  function setPresence(presence: "active" | "away") {
    patch({ presence });
  }

  function applyPreset(preset: { emoji: string; text: string }) {
    setEmoji(preset.emoji);
    setText(preset.text);
    patch({ statusEmoji: preset.emoji, statusText: preset.text, statusExpiresAt: expiryToDate(expiry) });
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

  if (!status) return null;

  const label = status.statusText
    ? `${status.statusEmoji ?? ""} ${status.statusText}`.trim()
    : status.presence === "away"
      ? "Away"
      : "Active";

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="card-surface flex items-center gap-2 rounded-full px-3 py-1.5 text-sm"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${status.presence === "active" ? "bg-green-500" : "bg-zinc-400"}`}
          aria-hidden
        />
        <span className="max-w-[160px] truncate text-zinc-700 dark:text-zinc-300">{label}</span>
        {status.doNotDisturb && <span title="Do not disturb">🌙</span>}
      </button>

      {open && (
        <div className="card-surface absolute right-0 z-20 mt-2 w-72 rounded-2xl p-3 text-sm">
          {status.slackSyncWarning && (
            <div className="mb-2 flex flex-col gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
              <p>⚠️ {status.slackSyncWarning}</p>
              <a
                href="/api/oauth/slack"
                className="self-start rounded-full bg-amber-500/20 px-2 py-1 font-semibold hover:bg-amber-500/30"
              >
                Reconnect Slack
              </a>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setPresence("active")}
              className={`flex-1 rounded-full px-3 py-1.5 font-medium ${
                status.presence === "active" ? "btn-primary text-white" : "border border-black/[.08] dark:border-white/[.145]"
              }`}
            >
              🟢 Active
            </button>
            <button
              onClick={() => setPresence("away")}
              className={`flex-1 rounded-full px-3 py-1.5 font-medium ${
                status.presence === "away" ? "btn-primary text-white" : "border border-black/[.08] dark:border-white/[.145]"
              }`}
            >
              ⚫ Away
            </button>
          </div>

          <div className="mt-3 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Custom status
            </p>
            <div className="mb-2 flex flex-wrap gap-1">
              {STATUS_PRESETS.map((p) => (
                <button
                  key={p.text}
                  onClick={() => applyPreset(p)}
                  className="rounded-full border border-black/[.08] px-2 py-1 text-xs hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
                >
                  {p.emoji} {p.text}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🙂"
                maxLength={4}
                className="w-12 rounded-lg border border-black/[.08] px-2 py-1.5 text-center outline-none dark:border-white/[.145] dark:bg-transparent"
              />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What's your status?"
                className="flex-1 rounded-lg border border-black/[.08] px-2 py-1.5 outline-none dark:border-white/[.145] dark:bg-transparent"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
                className="flex-1 rounded-lg border border-black/[.08] bg-transparent px-2 py-1.5 text-xs dark:border-white/[.145]"
              >
                <option value="none">Don&apos;t clear</option>
                <option value="30m">Clear after 30 min</option>
                <option value="1h">Clear after 1 hour</option>
                <option value="today">Clear at end of today</option>
              </select>
              <button
                onClick={saveCustomStatus}
                disabled={saving}
                className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Set
              </button>
              {(status.statusEmoji || status.statusText) && (
                <button onClick={clearStatus} className="text-xs text-zinc-500 dark:text-zinc-400">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
            <label className="flex items-center justify-between gap-2">
              <span>Automatically set Away after inactivity</span>
              <input
                type="checkbox"
                checked={status.autoAwayEnabled}
                onChange={(e) => patch({ autoAwayEnabled: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>Do not disturb</span>
              <input
                type="checkbox"
                checked={status.doNotDisturb}
                onChange={(e) => patch({ doNotDisturb: e.target.checked })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
