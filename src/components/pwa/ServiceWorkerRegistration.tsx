"use client";

import { useEffect } from "react";

/** Registers the service worker on every signed-in page, so offline support works even before push notifications are enabled. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
