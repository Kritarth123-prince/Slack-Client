import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { decryptToken } from "@/lib/slack/tokenCipher";
import { logger } from "@/lib/logger";

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

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const token = decryptToken({
    ciphertext: installation.encryptedAccessToken,
    iv: installation.tokenIv,
    authTag: installation.tokenAuthTag,
  });

  const upstream = await fetch(target.toString(), { headers: { Authorization: `Bearer ${token}` } }).catch((err) => {
    logger.error("Failed to proxy Slack file", { message: (err as Error).message });
    return null;
  });

  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
