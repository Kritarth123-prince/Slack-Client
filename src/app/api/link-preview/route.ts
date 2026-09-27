import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getLinkPreview } from "@/server/services/linkPreview";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = request.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  const preview = await getLinkPreview(url);
  return NextResponse.json({ preview }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
