"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreferencesView, UpdatePreferencesInput } from "@/server/services/preferences";

type SaveState = "idle" | "saving" | "saved" | "error";

const THEMES: { value: PreferencesView["theme"]; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITIES: { value: PreferencesView["density"]; label: string; hint: string }[] = [
  { value: "comfortable", label: "Comfortable", hint: "More breathing room between messages" },
  { value: "compact", label: "Compact", hint: "Fit more messages on screen" },
];

const NOTIFICATION_TOGGLES: { key: keyof UpdatePreferencesInput & keyof PreferencesView; label: string; hint: string }[] = [
  { key: "notifyDirectMessages", label: "Direct messages", hint: "DMs and group DMs" },
  { key: "notifyMentions", label: "Mentions", hint: "@you, @here and @channel anywhere" },
  { key: "notifyThreadReplies", label: "Thread replies", hint: "Replies in threads" },
  { key: "notifyChannelMessages", label: "All channel messages", hint: "Every message in channels you're in — noisy" },
];

function applyThemeNow(theme: PreferencesView["theme"]) {
  const root = document.documentElement;
  root.setAttribute("data-theme-pref", theme);
  const dark = theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  root.setAttribute("data-theme", dark ? "dark" : "light");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-surface flex flex-col gap-3 rounded-2xl p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium ${
            value === opt.value ? "btn-primary text-white" : "border border-black/[.08] dark:border-white/[.145]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: PreferencesView }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<PreferencesView>(initial);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [warning, setWarning] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quiet hours are meaningless without knowing which clock they're on, so the browser's zone is
  // recorded the first time the page is opened (and whenever it differs from what's saved).
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone !== initial.timezone) save({ timezone: zone }, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time capture on mount
  }, []);

  async function save(input: UpdatePreferencesInput, opts: { silent?: boolean } = {}) {
    if (!opts.silent) setSaveState("saving");
    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as PreferencesView;
      setPrefs(data);
      setDisplayName(data.displayName);
      setWarning(data.slackSyncWarning);
      if (!opts.silent) {
        setSaveState("saved");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
      }
    } catch {
      if (!opts.silent) setSaveState("error");
    }
  }

  function setTheme(theme: PreferencesView["theme"]) {
    setPrefs((p) => ({ ...p, theme }));
    applyThemeNow(theme);
    save({ theme });
  }

  function setDensity(density: PreferencesView["density"]) {
    setPrefs((p) => ({ ...p, density }));
    document.documentElement.setAttribute("data-density", density);
    save({ density }).then(() => router.refresh());
  }

  function toggle(key: (typeof NOTIFICATION_TOGGLES)[number]["key"], value: boolean) {
    setPrefs((p) => ({ ...p, [key]: value }));
    save({ [key]: value });
  }

  function setQuietHours(start: string | null, end: string | null) {
    setPrefs((p) => ({ ...p, quietHoursStart: start, quietHoursEnd: end }));
    save({ quietHoursStart: start, quietHoursEnd: end });
  }

  const quietEnabled = Boolean(prefs.quietHoursStart && prefs.quietHoursEnd);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-5 items-center justify-end text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && <span className="text-red-500">Couldn&apos;t save. Try again.</span>}
      </div>

      {warning && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <p>⚠️ {warning}</p>
          <a href="/api/oauth/slack" className="self-start rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold hover:bg-amber-500/30">
            Reconnect Slack
          </a>
        </div>
      )}

      <Section title="Profile">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (displayName.trim() && displayName.trim() !== prefs.displayName) save({ displayName: displayName.trim() });
          }}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-300">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              className="rounded-lg border border-black/[.08] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand-from)_40%,transparent)] dark:border-white/[.145]"
            />
          </label>
          <button
            type="submit"
            disabled={!displayName.trim() || displayName.trim() === prefs.displayName || saveState === "saving"}
            className="btn-primary rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Update
          </button>
        </form>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Changes your name on Slack itself, not just in this app.</p>
      </Section>

      <Section title="Appearance">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">Theme</span>
          <Segmented value={prefs.theme} options={THEMES} onChange={setTheme} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">Message density</span>
          <Segmented value={prefs.density} options={DENSITIES} onChange={setDensity} />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {DENSITIES.find((d) => d.value === prefs.density)?.hint}
          </p>
        </div>
      </Section>

      <Section title="Notifications">
        {NOTIFICATION_TOGGLES.map(({ key, label, hint }) => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block text-zinc-700 dark:text-zinc-200">{label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
            </span>
            <input type="checkbox" checked={prefs[key] as boolean} onChange={(e) => toggle(key, e.target.checked)} className="h-4 w-4" />
          </label>
        ))}

        <div className="mt-1 flex flex-col gap-2 border-t border-black/[.06] pt-3 dark:border-white/[.08]">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block text-zinc-700 dark:text-zinc-200">Quiet hours</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                No notifications between these times{prefs.timezone ? ` (${prefs.timezone})` : ""}
              </span>
            </span>
            <input
              type="checkbox"
              checked={quietEnabled}
              onChange={(e) => (e.target.checked ? setQuietHours("22:00", "07:00") : setQuietHours(null, null))}
              className="h-4 w-4"
            />
          </label>
          {quietEnabled && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="time"
                value={prefs.quietHoursStart ?? ""}
                onChange={(e) => setQuietHours(e.target.value || null, prefs.quietHoursEnd)}
                className="rounded-lg border border-black/[.08] bg-transparent px-2 py-1 dark:border-white/[.145]"
              />
              <span className="text-zinc-500 dark:text-zinc-400">to</span>
              <input
                type="time"
                value={prefs.quietHoursEnd ?? ""}
                onChange={(e) => setQuietHours(prefs.quietHoursStart, e.target.value || null)}
                className="rounded-lg border border-black/[.08] bg-transparent px-2 py-1 dark:border-white/[.145]"
              />
            </div>
          )}
        </div>
      </Section>

      <Section title="Account">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/oauth/slack"
            className="rounded-full border border-black/[.08] px-4 py-2 text-sm font-medium hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
          >
            Reconnect Slack
          </a>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="rounded-full px-4 py-2 text-sm text-red-500 hover:bg-red-500/10">
              Log out
            </button>
          </form>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Reconnect after this app adds new Slack permissions (file uploads, search) if a feature says it&apos;s missing one.
        </p>
      </Section>
    </div>
  );
}
