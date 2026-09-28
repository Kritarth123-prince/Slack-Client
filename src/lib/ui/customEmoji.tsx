"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const CustomEmojiContext = createContext<Record<string, string>>({});

export function useCustomEmoji(): Record<string, string> {
  return useContext(CustomEmojiContext);
}

let cachedMap: Record<string, string> | null = null;
let inFlight: Promise<Record<string, string>> | null = null;

function loadCustomEmoji(): Promise<Record<string, string>> {
  if (cachedMap) return Promise.resolve(cachedMap);
  if (!inFlight) {
    inFlight = fetch("/api/emoji")
      .then((res) => (res.ok ? res.json() : { emoji: {} }))
      .then((data: { emoji?: Record<string, string> }) => {
        cachedMap = data.emoji ?? {};
        return cachedMap;
      })
      .catch(() => ({}));
  }
  return inFlight;
}

/** Fetches the workspace's custom emoji once per session and makes them available to SlackText and reaction pills. */
export function CustomEmojiProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, string>>(() => cachedMap ?? {});

  useEffect(() => {
    let cancelled = false;
    loadCustomEmoji().then((result) => {
      if (!cancelled) setMap(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <CustomEmojiContext.Provider value={map}>{children}</CustomEmojiContext.Provider>;
}
