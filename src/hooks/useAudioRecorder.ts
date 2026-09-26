"use client";

import { useRef, useState } from "react";

const MAX_RECORDING_MS = 5 * 60 * 1000;
const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Wraps getUserMedia + MediaRecorder for recording a short voice note as a single Blob. */
export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cleanupTimers() {
    if (tickRef.current) clearInterval(tickRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    tickRef.current = null;
    autoStopRef.current = null;
  }

  function teardownStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function start() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice notes aren't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;

      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setIsRecording(true);

      tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
      autoStopRef.current = setTimeout(() => stop().catch(() => {}), MAX_RECORDING_MS);
    } catch {
      setError("Microphone permission was denied.");
      teardownStream();
    }
  }

  function stop(): Promise<Blob | null> {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        cleanupTimers();
        teardownStream();
        setIsRecording(false);
        resolve(blob);
      };
      recorder.stop();
    });
  }

  function cancel() {
    const recorder = recorderRef.current;
    cleanupTimers();
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    chunksRef.current = [];
    teardownStream();
    setIsRecording(false);
    setElapsedMs(0);
  }

  return { isRecording, elapsedMs, error, start, stop, cancel };
}
