"use client";

import { useEffect, useState } from "react";
import type { TranscriptResult } from "@/server/services/transcription";

// The server says "disabled" once when no transcription endpoint is configured; remember that so
// every voice note on the page doesn't ask again.
let transcriptionDisabled = false;
const transcriptCache = new Map<string, Promise<TranscriptResult>>();

function loadTranscript(fileId: string, url: string): Promise<TranscriptResult> {
  let pending = transcriptCache.get(fileId);
  if (!pending) {
    pending = fetch(`/api/files/transcript?fileId=${encodeURIComponent(fileId)}&url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : { status: "failed" }))
      .then((data: TranscriptResult) => {
        if (data.status === "disabled") transcriptionDisabled = true;
        return data;
      })
      .catch((): TranscriptResult => ({ status: "failed" }));
    transcriptCache.set(fileId, pending);
  }
  return pending;
}

/** Speech-to-text for a voice note, shown under its player. Renders nothing when transcription isn't configured. */
export function VoiceTranscript({ fileId, proxyUrl }: { fileId: string; proxyUrl: string }) {
  const [result, setResult] = useState<TranscriptResult | null>(null);

  useEffect(() => {
    if (transcriptionDisabled) return;
    const url = new URLSearchParams(proxyUrl.split("?")[1] ?? "").get("url");
    if (!url) return;
    let cancelled = false;
    loadTranscript(fileId, url).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [fileId, proxyUrl]);

  if (transcriptionDisabled) return null;
  if (!result) return <span className="text-[11px] italic text-zinc-400 dark:text-zinc-500">Transcribing…</span>;
  if (result.status !== "ready") return null;

  return (
    <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-300" title={result.language ? `Detected language: ${result.language}` : undefined}>
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Transcript</span>
      {result.text}
    </p>
  );
}
