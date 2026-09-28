import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { remindAboutMessage } from "@/server/services/reminders";

export async function POST(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { messageId?: unknown; time?: unknown } | null;
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const time = typeof body?.time === "number" || typeof body?.time === "string" ? body.time : null;
  if (!messageId || time === null) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await remindAboutMessage(userId, messageId, time);
  if (result.ok) return NextResponse.json({ ok: true });

  const status = result.error === "not_found" ? 404 : result.error === "missing_scope" ? 403 : 502;
  return NextResponse.json({ error: result.error }, { status });
}
