import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export interface LinkPreviewView {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;
const RETRY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000;

// This server fetches arbitrary user-posted URLs, so anything that could point back into the
// deployment's own network is refused up front — hostnames first, then the resolved address
// after redirects (via response.url) since a public hostname can redirect to a private one.
const BLOCKED_HOST_RE = /^(localhost|.*\.local|.*\.internal|.*\.localhost|0\.0\.0\.0|\[::1\]|::1)$/i;
const PRIVATE_IPV4_RE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

function isBlockedUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOST_RE.test(host)) return true;
  if (PRIVATE_IPV4_RE.test(host)) return true;
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6 literals — no need to support them
  return false;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    // <meta property="og:title" content="..."> in either attribute order
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
    ];
    for (const re of patterns) {
      const match = html.match(re);
      if (match?.[1]) return decodeEntities(match[1]);
    }
  }
  return null;
}

async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (html.includes("</head>")) break;
  }
  reader.cancel().catch(() => {});
  return html;
}

async function fetchPreview(url: URL): Promise<Omit<LinkPreviewView, "url"> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SlackWebLinkPreview/1.0)", Accept: "text/html,*/*;q=0.5" },
    });
    if (!response.ok) return null;
    if (isBlockedUrl(new URL(response.url))) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await readHead(response);
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
    const title = metaContent(html, ["og:title", "twitter:title"]) ?? (titleTag ? decodeEntities(titleTag) : null);
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    const rawImage = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
    let imageUrl: string | null = null;
    if (rawImage) {
      try {
        const resolved = new URL(rawImage, response.url);
        if (resolved.protocol === "https:" || resolved.protocol === "http:") imageUrl = resolved.toString();
      } catch {
        // unusable image url — just skip the image
      }
    }
    const siteName = metaContent(html, ["og:site_name"]) ?? url.hostname.replace(/^www\./, "");

    if (!title && !description && !imageUrl) return null;
    return { title, description, imageUrl, siteName };
  } finally {
    clearTimeout(timer);
  }
}

/** Returns cached Open Graph metadata for a URL, fetching (and caching, including failures) on first sight. */
export async function getLinkPreview(rawUrl: string): Promise<LinkPreviewView | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (isBlockedUrl(url)) return null;
  // Slack's own file/permalink URLs need the user's token and render as attachments already.
  if (/(^|\.)slack\.com$|(^|\.)slack-files\.com$|(^|\.)slack-edge\.com$/i.test(url.hostname)) return null;
  url.hash = "";
  const key = url.toString();

  const cached = await prisma.linkPreview.findUnique({ where: { url: key } });
  if (cached) {
    const stale = cached.failed && Date.now() - cached.fetchedAt.getTime() > RETRY_FAILED_AFTER_MS;
    if (!stale) {
      return cached.failed
        ? null
        : { url: key, title: cached.title, description: cached.description, imageUrl: cached.imageUrl, siteName: cached.siteName };
    }
  }

  let preview: Omit<LinkPreviewView, "url"> | null = null;
  try {
    preview = await fetchPreview(url);
  } catch (err) {
    logger.info("Link preview fetch failed", { host: url.hostname, message: (err as Error).message });
  }

  await prisma.linkPreview.upsert({
    where: { url: key },
    update: { ...(preview ?? { title: null, description: null, imageUrl: null, siteName: null }), failed: !preview, fetchedAt: new Date() },
    create: { url: key, ...(preview ?? {}), failed: !preview },
  });

  return preview ? { url: key, ...preview } : null;
}
