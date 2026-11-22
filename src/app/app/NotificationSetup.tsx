"use client";

import { useEffect, useState } from "react";
import { Bell, Smartphone, X } from "lucide-react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type Status = "checking" | "unsupported" | "ios-not-installed" | "enabled" | "disabled";

const DISMISS_KEY = "notification-prompt-dismissed";

function isPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

// iOS Safari only exposes the Push API to a site once it's been added to the home screen — in a
// regular browser tab `PushManager` simply doesn't exist, so isPushSupported() alone can't tell
// the difference between "this device can never support push" and "add it to the home screen
// first". Distinguishing the two is what lets us show a useful instruction instead of nothing.
function isIosNotInstalled(): boolean {
  if (typeof navigator === "undefined") return false;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

function initialStatus(): Status {
  if (isPushSupported()) return "checking";
  if (isIosNotInstalled()) return "ios-not-installed";
  return "unsupported";
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** A compact prompt in the sidebar to turn on push notifications for this device. Dismissible. */
export function NotificationSetup() {
  const [status, setStatus] = useState<Status>("checking");
  const [dismissed, setDismissed] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read browser-only state after mount so the server render and first client render match.
    const initial = initialStatus();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser APIs that don't exist during SSR
    setStatus(initial);
    setDismissed(wasDismissed());
    if (initial !== "checking") return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setStatus(subscription ? "enabled" : "disabled"))
      .catch(() => setStatus("disabled"));
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode — it'll just show again next time
    }
  }

  async function enable() {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notifications are blocked. Allow them in your browser's site settings.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/vapid-public-key");
      const { publicKey } = (await keyRes.json()) as { publicKey: string };

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setStatus("enabled");
    } catch {
      setError("Couldn't enable notifications on this device.");
    }
  }

  if (dismissed || status === "checking" || status === "unsupported" || status === "enabled") return null;

  const ios = status === "ios-not-installed";
  const Icon = ios ? Smartphone : Bell;

  return (
    <div className="relative flex gap-2.5 rounded-lg border border-line bg-surface p-2.5 text-xs">
      <Icon size={16} className="mt-0.5 shrink-0 text-accent-text" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="pr-4 text-muted">
          {ios
            ? "To get notifications on iPhone, tap Share in Safari, then “Add to Home Screen”, and open the app from there."
            : "Get notified about new messages, even when this tab is closed."}
        </p>
        {!ios && (
          <button type="button" onClick={enable} className="btn-primary h-7 self-start rounded-md px-2.5 font-semibold">
            Turn on notifications
          </button>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}
