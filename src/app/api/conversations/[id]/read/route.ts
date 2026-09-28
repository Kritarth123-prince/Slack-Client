import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { markConversationRead } from "@/lib/slack/sync";

/** Moves the read cursor — used for "mark as unread from here" (cursor set to just before a message). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { lastReadTs?: unknown } | null;
  const lastReadTs = typeof body?.lastReadTs === "string" ? body.lastReadTs : null;
  if (lastReadTs === null) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  await markConversationRead(userId, id, lastReadTs, { rewind: true });
  return NextResponse.json({ ok: true });
}
