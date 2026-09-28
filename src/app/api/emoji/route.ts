import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { syncCustomEmoji, getCustomEmojiMap } from "@/server/services/customEmoji";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  await syncCustomEmoji(userId).catch(() => {});
  return NextResponse.json({ emoji: await getCustomEmojiMap(userId) }, { headers: { "Cache-Control": "private, max-age=600" } });
}
