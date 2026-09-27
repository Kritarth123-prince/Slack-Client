import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { recordTyping, clearTyping } from "@/server/services/presenceSignals";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { threadTs?: unknown; stop?: unknown } | null;
  const threadTs = typeof body?.threadTs === "string" ? body.threadTs : "";

  if (body?.stop === true) await clearTyping(userId, conversation, threadTs);
  else await recordTyping(userId, conversation, threadTs);

  return NextResponse.json({ ok: true });
}
