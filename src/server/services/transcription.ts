import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { decryptToken } from "@/lib/slack/tokenCipher";
import { getActiveInstallation } from "@/lib/slack/installation";
import { logger } from "@/lib/logger";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 90_000;

export function transcriptionEnabled(): boolean {
  return Boolean(getEnv().TRANSCRIPTION_API_URL);
}

function endpoint(): string {
  const base = getEnv().TRANSCRIPTION_API_URL!;
  // Accept either the bare host ("https://api.openai.com") or the full path.
  return base.replace(/\/+$/, "").endsWith("/transcriptions") ? base : `${base.replace(/\/+$/, "")}/v1/audio/transcriptions`;
}

export type TranscriptResult =
  | { status: "ready"; text: string; language: string | null }
  | { status: "disabled" }
  | { status: "failed" };

/**
 * Transcribes a voice note once and caches it by Slack file id. The audio is fetched from Slack
 * with the user's token (same as the file proxy) and posted to the configured OpenAI-compatible
 * speech-to-text endpoint — so the same code path serves OpenAI Whisper, a local Whisper server,
 * or a custom Hindi/Hinglish ASR model that speaks that API.
 */
export async function getVoiceTranscript(userId: string, fileId: string, urlPrivate: string): Promise<TranscriptResult> {
  if (!transcriptionEnabled()) return { status: "disabled" };

  const cached = await prisma.voiceTranscript.findUnique({ where: { fileId } });
  if (cached) return { status: "ready", text: cached.text, language: cached.language };

  const installation = await getActiveInstallation(userId);
  if (!installation) return { status: "failed" };
  const token = decryptToken({
    ciphertext: installation.encryptedAccessToken,
    iv: installation.tokenIv,
    authTag: installation.tokenAuthTag,
  });

  try {
    const audio = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${token}` } });
    if (!audio.ok) return { status: "failed" };
    const contentLength = Number(audio.headers.get("content-length") ?? 0);
    if (contentLength > MAX_AUDIO_BYTES) return { status: "failed" };
    const blob = await audio.blob();
    if (blob.size === 0 || blob.size > MAX_AUDIO_BYTES) return { status: "failed" };

    const env = getEnv();
    const form = new FormData();
    const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("mpeg") ? "mp3" : "webm";
    form.append("file", blob, `voice-note.${extension}`);
    form.append("model", env.TRANSCRIPTION_MODEL);
    form.append("response_format", "json");
    if (env.TRANSCRIPTION_LANGUAGE) form.append("language", env.TRANSCRIPTION_LANGUAGE);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(endpoint(), {
      method: "POST",
      body: form,
      signal: controller.signal,
      headers: env.TRANSCRIPTION_API_KEY ? { Authorization: `Bearer ${env.TRANSCRIPTION_API_KEY}` } : {},
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      logger.warn("Transcription request failed", { status: res.status });
      return { status: "failed" };
    }
    const data = (await res.json()) as { text?: string; language?: string };
    const text = (data.text ?? "").trim();
    if (!text) return { status: "failed" };

    await prisma.voiceTranscript.upsert({
      where: { fileId },
      update: { text, language: data.language ?? null },
      create: { fileId, text, language: data.language ?? null },
    });
    return { status: "ready", text, language: data.language ?? null };
  } catch (err) {
    logger.warn("Transcription failed", { message: (err as Error).message });
    return { status: "failed" };
  }
}
