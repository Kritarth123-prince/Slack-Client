import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { searchMessages } from "@/server/services/search";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!query) return NextResponse.json({ results: [], total: 0, error: null });

  try {
    return NextResponse.json(await searchMessages(userId, query));
  } catch (err) {
    logger.error("Search failed", { message: (err as Error).message });
    return NextResponse.json({ results: [], total: 0, error: "failed" }, { status: 500 });
  }
}

// These call Slack (sometimes several times) per request; the platform default timeout on some
// hosts is 10s, which is easy to hit during a first sync.
export const maxDuration = 60;
