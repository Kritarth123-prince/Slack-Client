export interface SlackFileView {
  id: string;
  name: string;
  filetype: string;
  size: number;
  isImage: boolean;
  proxyUrl: string;
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
    const urlPrivate = typeof file.url_private === "string" ? file.url_private : undefined;
    if (!id || !urlPrivate) continue;

    const mimetype = typeof file.mimetype === "string" ? file.mimetype : "";

    result.push({
      id,
      name: typeof file.name === "string" ? file.name : "file",
      filetype: typeof file.filetype === "string" ? file.filetype : "",
      size: typeof file.size === "number" ? file.size : 0,
      isImage: mimetype.startsWith("image/"),
      proxyUrl: `/api/files/proxy?url=${encodeURIComponent(urlPrivate)}`,
    });
  }
  return result;
}
