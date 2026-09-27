export interface SlackFileView {
  id: string;
  name: string;
  filetype: string;
  size: number;
  isImage: boolean;
  isAudio: boolean;
  proxyUrl: string;
}

// Slack's own `mimetype` for a browser-recorded voice note isn't always `audio/*` (e.g. some
// browsers report an audio-only MediaRecorder blob as `video/mp4`), so audio detection also falls
// back to Slack's normalized `filetype` and, failing that, the filename extension.
const AUDIO_FILETYPES = new Set(["webm", "m4a", "mp3", "wav", "ogg", "oga", "aac", "flac", "opus", "mp4a"]);
const AUDIO_EXTENSION_RE = /\.(webm|m4a|mp3|wav|ogg|oga|aac|flac|opus)$/i;

/** Pulls attached files out of a message's raw Slack payload for display. */
export function extractSlackFiles(raw: unknown): SlackFileView[] {
  if (!raw || typeof raw !== "object") return [];
  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];

  const result: SlackFileView[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as Record<string, unknown>;

    const id = typeof file.id === "string" ? file.id : undefined;
    const urlPrivate = typeof file.url_private === "string" ? file.url_private : undefined;
    if (!id || !urlPrivate) continue;

    const mimetype = typeof file.mimetype === "string" ? file.mimetype : "";
    const filetype = typeof file.filetype === "string" ? file.filetype.toLowerCase() : "";
    const name = typeof file.name === "string" ? file.name : "file";

    result.push({
      id,
      name,
      filetype: typeof file.filetype === "string" ? file.filetype : "",
      size: typeof file.size === "number" ? file.size : 0,
      isImage: mimetype.startsWith("image/"),
      isAudio: mimetype.startsWith("audio/") || AUDIO_FILETYPES.has(filetype) || AUDIO_EXTENSION_RE.test(name),
      proxyUrl: `/api/files/proxy?url=${encodeURIComponent(urlPrivate)}`,
    });
  }
  return result;
}
