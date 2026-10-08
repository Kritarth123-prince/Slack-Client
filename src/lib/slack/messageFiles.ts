export type FileKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "archive"
  | "code"
  | "text"
  | "other";

export interface SlackFileView {
  id: string;
  name: string;
  filetype: string;
  size: number;
  kind: FileKind;
  isImage: boolean;
  isAudio: boolean;
  /** Streams the bytes through this server with the user's token; null when Slack gave no private URL (e.g. an external/Google Drive file). */
  proxyUrl: string | null;
  /** Slack's own page for the file — the fallback when there's nothing to proxy. */
  externalUrl: string | null;
}

// Slack's own `mimetype` for a browser-recorded voice note isn't always `audio/*` (e.g. some
// browsers report an audio-only MediaRecorder blob as `video/mp4`), so audio detection also falls
// back to Slack's normalized `filetype` and, failing that, the filename extension.
const AUDIO_FILETYPES = new Set(["webm", "m4a", "mp3", "wav", "ogg", "oga", "aac", "flac", "opus", "mp4a"]);
const AUDIO_EXTENSION_RE = /\.(webm|m4a|mp3|wav|ogg|oga|aac|flac|opus)$/i;

const KIND_BY_EXTENSION: [RegExp, FileKind][] = [
  [/\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i, "image"],
  [/\.(mp4|mov|mkv|avi|m4v|wmv)$/i, "video"],
  [/\.pdf$/i, "pdf"],
  [/\.(docx?|dotx?|odt|rtf|pages)$/i, "word"],
  [/\.(xlsx?|xlsm|csv|tsv|ods|numbers)$/i, "excel"],
  [/\.(pptx?|ppsx?|odp|key)$/i, "powerpoint"],
  [/\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i, "archive"],
  [/\.(js|ts|jsx|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|sh|json|ya?ml|xml|html?|css|sql|kt|swift)$/i, "code"],
  [/\.(txt|md|log)$/i, "text"],
];

const KIND_BY_FILETYPE: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  gdoc: "word",
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  gsheet: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  gpres: "powerpoint",
  zip: "archive",
  rar: "archive",
  gzip: "archive",
  tar: "archive",
  text: "text",
  markdown: "text",
  javascript: "code",
  python: "code",
  java: "code",
  json: "code",
  mp4: "video",
  mov: "video",
  quicktime: "video",
};

function classify(name: string, filetype: string, mimetype: string, isAudio: boolean): FileKind {
  if (mimetype.startsWith("image/")) return "image";
  if (isAudio) return "audio";
  if (mimetype.startsWith("video/")) return "video";
  for (const [re, kind] of KIND_BY_EXTENSION) if (re.test(name)) return kind;
  if (KIND_BY_FILETYPE[filetype]) return KIND_BY_FILETYPE[filetype];
  if (mimetype === "application/pdf") return "pdf";
  if (mimetype.includes("spreadsheet") || mimetype.includes("excel")) return "excel";
  if (mimetype.includes("presentation") || mimetype.includes("powerpoint")) return "powerpoint";
  if (mimetype.includes("word") || mimetype.includes("opendocument.text")) return "word";
  if (mimetype.includes("zip") || mimetype.includes("compressed") || mimetype.includes("x-tar")) return "archive";
  if (mimetype.startsWith("text/")) return "text";
  return "other";
}

/** Classifies a local file (e.g. a pending attachment) the same way synced Slack files are. */
export function classifyLocalFile(name: string, mimetype: string): FileKind {
  const isAudio = mimetype.startsWith("audio/") || AUDIO_EXTENSION_RE.test(name);
  return classify(name, "", mimetype, isAudio);
}

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
    if (!id) continue;
    // Deleted/hidden files come through as tombstones with nothing to show.
    if (file.mode === "tombstone" || file.mode === "hidden_by_limit") continue;

    const urlPrivate =
      typeof file.url_private === "string"
        ? file.url_private
        : typeof file.url_private_download === "string"
          ? file.url_private_download
          : undefined;
    const permalink = typeof file.permalink === "string" ? file.permalink : undefined;
    if (!urlPrivate && !permalink) continue;

    const mimetype = typeof file.mimetype === "string" ? file.mimetype : "";
    const filetype = typeof file.filetype === "string" ? file.filetype.toLowerCase() : "";
    const name = typeof file.name === "string" ? file.name : typeof file.title === "string" ? file.title : "file";
    const isAudio = mimetype.startsWith("audio/") || AUDIO_FILETYPES.has(filetype) || AUDIO_EXTENSION_RE.test(name);
    const kind = classify(name, filetype, mimetype, isAudio);

    result.push({
      id,
      name,
      filetype: typeof file.filetype === "string" ? file.filetype : "",
      size: typeof file.size === "number" ? file.size : 0,
      kind,
      isImage: kind === "image",
      isAudio,
      proxyUrl: urlPrivate ? `/api/files/proxy?url=${encodeURIComponent(urlPrivate)}` : null,
      externalUrl: permalink ?? null,
    });
  }
  return result;
}
