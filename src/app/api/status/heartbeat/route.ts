import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { recordActivity } from "@/lib/slack/presence";
import { logger } from "@/lib/logger";

export async function POST() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    await recordActivity(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Failed to record activity heartbeat", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
