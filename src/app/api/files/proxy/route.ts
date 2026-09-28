import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { decryptToken } from "@/lib/slack/tokenCipher";
import { logger } from "@/lib/logger";
import { getActiveInstallation } from "@/lib/slack/installation";

// Slack serves file content from these hosts; anything else is refused so this
// route can't be used as an open proxy for arbitrary URLs.
const ALLOWED_HOSTS = [/(^|\.)slack-files\.com$/, /^files\.slack\.com$/, /(^|\.)slack-edge\.com$/];

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const urlParam = request.nextUrl.searchParams.get("url");
  if (!urlParam) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return NextResponse.json({ error: "forbidden_host" }, { status: 400 });
  }

  const installation = await getActiveInstallation(userId);
  if (!installation) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const token = decryptToken({
    ciphertext: installation.encryptedAccessToken,
    iv: installation.tokenIv,
    authTag: installation.tokenAuthTag,
  });

  // Mobile Safari's <audio>/<video> refuse to play a resource at all unless the server answers
  // range requests (206 + Content-Range) — desktop browsers are far more lenient and will happily
  // play a plain 200 response, which is why voice notes/video played fine on desktop but errored
  // out on iOS. So the incoming Range request is forwarded upstream, and Slack's response status
  // and range headers are relayed back as-is rather than always answering with a flat 200.
  const rangeHeader = request.headers.get("range");
  const upstream = await fetch(target.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    },
  }).catch((err) => {
    logger.error("Failed to proxy Slack file", { message: (err as Error).message });
    return null;
  });

  if (!upstream || !upstream.body || (upstream.status !== 200 && upstream.status !== 206)) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  });
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("Content-Range", contentRange);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
