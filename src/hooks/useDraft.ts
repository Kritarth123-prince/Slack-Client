"use client";

import { useEffect, useRef, useState } from "react";

const SAVE_DEBOUNCE_MS = 600;

/**
 * Persists the composer's in-progress text server-side, per conversation (and per open thread),
 * so it survives navigating away or reloading. Loads once on mount and debounces saves so every
 * keystroke doesn't round-trip to the server.
 */
export function useDraft(conversationId: string, threadTs?: string) {
  const [text, setText] = useState("");
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Runs once per mount rather than resetting on conversationId/threadTs change — callers remount
  // this (e.g. a `key={conversationId}` on the component using the hook) when switching to a
  // different chat or thread, so this always starts from a blank slate rather than needing to
  // synchronously reset state itself.
  useEffect(() => {
    const params = threadTs ? `?threadTs=${encodeURIComponent(threadTs)}` : "";
    fetch(`/api/conversations/${conversationId}/draft${params}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { text?: string } | null) => {
        if (data?.text) setText(data.text);
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity changes are handled by remounting via `key`, not by re-running this effect
  }, []);

  function update(value: string) {
    setText(value);
    if (!loadedRef.current) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/conversations/${conversationId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value, threadTs }),
      }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }

  function clear() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setText("");
    fetch(`/api/conversations/${conversationId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "", threadTs }),
    }).catch(() => {});
  }

  return { text, setText: update, clear };
}
