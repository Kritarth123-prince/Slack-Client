"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import type { PreferencesView, SlackSyncStatus, UpdatePreferencesInput } from "@/server/services/preferences";

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
  { key: "notifyThreadReplies", label: "Thread replies", hint: "Replies in threads you've started or joined" },
  { key: "notifyChannelMessages", label: "All channel messages", hint: "Every message in channels you're in — noisy" },
];

const INPUT = "h-9 rounded-lg border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent";

function applyThemeNow(theme: PreferencesView["theme"]) {
  const root = document.documentElement;
  root.setAttribute("data-theme-pref", theme);
  const dark = theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  root.setAttribute("data-theme", dark ? "dark" : "light");
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card-surface rounded-xl">
      <header className="border-b border-line px-5 py-3.5">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-subtle">{description}</p>}
      </header>
      <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-8 rounded-md text-sm font-medium ${
            value === opt.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line-strong"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-4" : ""}`}
      />
    </button>
  );
}

function SyncRow({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      {ok ? (
        <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" />
      ) : (
        <CircleDashed size={18} className="mt-0.5 shrink-0 text-subtle" />
      )}
      <div className="min-w-0 text-sm">
        <p className="font-medium text-fg">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

export function SettingsForm({ initial, syncStatus }: { initial: PreferencesView; syncStatus: SlackSyncStatus }) {
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
  const { readToSlack, lastEventAt } = syncStatus;

  return (
    <div className="flex flex-col gap-5">
      <div className="-mb-2 flex h-5 items-center justify-end text-xs text-subtle" aria-live="polite">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && <span className="text-danger">Couldn&apos;t save. Try again.</span>}
      </div>

      {warning && (
        <div className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-sm text-warning">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-1.5">
            <p>{warning}</p>
            <a href="/api/oauth/slack" className="self-start font-semibold underline underline-offset-2">
              Reconnect Slack
            </a>
          </div>
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
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
            <span className="font-medium text-fg">Display name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} className={INPUT} />
          </label>
          <button
            type="submit"
            disabled={!displayName.trim() || displayName.trim() === prefs.displayName || saveState === "saving"}
            className="btn-primary h-9 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            Update
          </button>
        </form>
        <p className="-mt-2 text-xs text-subtle">Changes your name in Slack itself, not just in this app.</p>
      </Section>

      <Section title="Appearance">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Theme</span>
          <Segmented label="Theme" value={prefs.theme} options={THEMES} onChange={setTheme} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Message density</span>
          <Segmented label="Message density" value={prefs.density} options={DENSITIES} onChange={setDensity} />
          <p className="text-xs text-subtle">{DENSITIES.find((d) => d.value === prefs.density)?.hint}</p>
        </div>
      </Section>

      <Section title="Notifications" description="Push notifications on this device. Muted conversations never notify.">
        {NOTIFICATION_TOGGLES.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <span className="text-sm">
              <span className="block font-medium text-fg">{label}</span>
              <span className="block text-xs text-subtle">{hint}</span>
            </span>
            <Toggle label={label} checked={prefs[key] as boolean} onChange={(v) => toggle(key, v)} />
          </div>
        ))}

        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">
              <span className="block font-medium text-fg">Quiet hours</span>
              <span className="block text-xs text-subtle">
                No notifications between these times{prefs.timezone ? ` (${prefs.timezone})` : ""}
              </span>
            </span>
            <Toggle
              label="Quiet hours"
              checked={quietEnabled}
              onChange={(on) => (on ? setQuietHours("22:00", "07:00") : setQuietHours(null, null))}
            />
          </div>
          {quietEnabled && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="time"
                aria-label="Quiet hours start"
                value={prefs.quietHoursStart ?? ""}
                onChange={(e) => setQuietHours(e.target.value || null, prefs.quietHoursEnd)}
                className={INPUT}
              />
              <span className="text-subtle">to</span>
              <input
                type="time"
                aria-label="Quiet hours end"
                value={prefs.quietHoursEnd ?? ""}
                onChange={(e) => setQuietHours(prefs.quietHoursStart, e.target.value || null)}
                className={INPUT}
              />
            </div>
          )}
        </div>
      </Section>

      <Section title="Sync with Slack" description="How this app stays in step with Slack's own apps.">
        <SyncRow ok title="Read in Slack → cleared here">
          Reading a conversation in Slack&apos;s apps clears its unread badge here within about 15 seconds.
        </SyncRow>
        <SyncRow ok={readToSlack.enabled} title="Read here → cleared in Slack">
          {readToSlack.enabled ? (
            "Reading a conversation here marks it read in Slack's apps too."
          ) : (
            <>
              Off — your Slack connection is missing{" "}
              {readToSlack.missingScopes.map((s, i) => (
                <span key={s}>
                  {i > 0 && ", "}
                  <code className="rounded bg-surface-2 px-1 py-px text-[11px]">{s}</code>
                </span>
              ))}
              .{" "}
              {readToSlack.requested ? (
                <>Reconnect Slack below to grant them.</>
              ) : (
                <>
                  Add them under <em>User Token Scopes</em> in your Slack app&apos;s settings, set{" "}
                  <code className="rounded bg-surface-2 px-1 py-px text-[11px]">SLACK_EXTRA_USER_SCOPES</code> to the same list in
                  the server&apos;s <code className="rounded bg-surface-2 px-1 py-px text-[11px]">.env</code>, restart, then
                  reconnect below.
                </>
              )}
            </>
          )}
        </SyncRow>
        <SyncRow ok={Boolean(lastEventAt)} title="Real-time events">
          {lastEventAt
            ? `Slack's events webhook is reaching this app (last event ${timeAgo(lastEventAt)}).`
            : "Slack's events webhook hasn't reached this app (normal on localhost), so new messages, edits and reactions arrive by polling every few seconds instead."}
        </SyncRow>
        <SyncRow ok title="Presence">
          &ldquo;Away&rdquo; set here applies in Slack. Slack decides &ldquo;Active&rdquo; itself from activity in its own
          apps — no other app is allowed to mark you active.
        </SyncRow>
      </Section>

      <Section title="Account">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/oauth/slack"
            className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Reconnect Slack
          </a>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="h-9 rounded-lg px-4 text-sm font-medium text-danger hover:bg-danger-soft">
              Log out
            </button>
          </form>
        </div>
        <p className="text-xs text-subtle">
          Reconnect after this app adds new Slack permissions, or if a feature says one is missing.
        </p>
      </Section>
    </div>
  );
}
