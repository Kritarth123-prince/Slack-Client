import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { scheduleMessage, listScheduledMessages, cancelScheduledMessage, validatePostAt } from "@/server/services/scheduled";
import { logger } from "@/lib/logger";

function slackError(err: unknown) {
  return (err as { data?: { error?: string } }).data?.error;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    return NextResponse.json({ scheduled: await listScheduledMessages(userId, conversation) });
  } catch (err) {
    logger.error("Failed to list scheduled messages", { message: (err as Error).message });
    return NextResponse.json({ scheduled: [], error: slackError(err) ?? "failed" });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; postAt?: unknown; threadTs?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  const postAt = typeof body?.postAt === "string" ? validatePostAt(body.postAt) : null;
  if (!postAt) return NextResponse.json({ error: "invalid_time" }, { status: 400 });
  const threadTs = typeof body?.threadTs === "string" && body.threadTs ? body.threadTs : undefined;

  try {
    return NextResponse.json({ scheduled: await scheduleMessage(userId, conversation, { text, postAt, threadTs }) });
  } catch (err) {
    logger.error("Failed to schedule message", { message: (err as Error).message });
    return NextResponse.json({ error: slackError(err) ?? "failed" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const scheduledMessageId = request.nextUrl.searchParams.get("scheduledMessageId");
  if (!scheduledMessageId) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  try {
    await cancelScheduledMessage(userId, conversation, scheduledMessageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Failed to cancel scheduled message", { message: (err as Error).message });
    return NextResponse.json({ error: slackError(err) ?? "failed" }, { status: 502 });
  }
}
