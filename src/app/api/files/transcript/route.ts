import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getVoiceTranscript, transcriptionEnabled } from "@/server/services/transcription";

const ALLOWED_HOSTS = [/(^|\.)slack-files\.com$/, /^files\.slack\.com$/, /(^|\.)slack-edge\.com$/];

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!transcriptionEnabled()) return NextResponse.json({ status: "disabled" });

  const fileId = request.nextUrl.searchParams.get("fileId");
  const urlParam = request.nextUrl.searchParams.get("url");
  if (!fileId || !urlParam) return NextResponse.json({ error: "missing_params" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.some((re) => re.test(target.hostname))) {
    return NextResponse.json({ error: "forbidden_host" }, { status: 400 });
  }

  return NextResponse.json(await getVoiceTranscript(userId, fileId, target.toString()));
}

// These call Slack (sometimes several times) per request; the platform default timeout on some
// hosts is 10s, which is easy to hit during a first sync.
export const maxDuration = 60;
