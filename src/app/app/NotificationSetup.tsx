"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type Status = "checking" | "unsupported" | "enabled" | "disabled";

function isPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export function NotificationSetup() {
  const [status, setStatus] = useState<Status>(() => (isPushSupported() ? "checking" : "unsupported"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setStatus(subscription ? "enabled" : "disabled"))
      .catch(() => setStatus("disabled"));
  }, []);

  async function enable() {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notifications were blocked. Enable them in your browser's site settings.");
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

  if (status === "checking" || status === "unsupported" || status === "enabled") return null;

  return (
    <div className="card-surface flex items-center gap-3 rounded-2xl px-4 py-3">
      <span className="text-lg" aria-hidden>
        🔔
      </span>
      <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">
        Enable notifications to hear about new messages even when this tab is closed.
      </p>
      <button onClick={enable} className="btn-primary rounded-full px-4 py-2 text-sm font-semibold text-white">
        Enable
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
