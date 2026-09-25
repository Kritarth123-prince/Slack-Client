import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getStatus, updateStatus, type UpdateStatusInput } from "@/lib/slack/presence";
import { logger } from "@/lib/logger";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    return NextResponse.json(await getStatus(userId));
  } catch (err) {
    logger.error("Failed to load status", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as UpdateStatusInput | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const input: UpdateStatusInput = {
    presence: body.presence === "active" || body.presence === "away" ? body.presence : undefined,
    autoAwayEnabled: typeof body.autoAwayEnabled === "boolean" ? body.autoAwayEnabled : undefined,
    doNotDisturb: typeof body.doNotDisturb === "boolean" ? body.doNotDisturb : undefined,
    statusEmoji: body.statusEmoji === null || typeof body.statusEmoji === "string" ? body.statusEmoji : undefined,
    statusText: body.statusText === null || typeof body.statusText === "string" ? body.statusText : undefined,
    statusExpiresAt:
      body.statusExpiresAt === null || typeof body.statusExpiresAt === "string" ? body.statusExpiresAt : undefined,
    clearStatus: body.clearStatus === true,
  };

  try {
    return NextResponse.json(await updateStatus(userId, input));
  } catch (err) {
    logger.error("Failed to update status", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
