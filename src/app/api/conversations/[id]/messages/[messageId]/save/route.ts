import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, messageId } = await params;
  const message = await prisma.message.findFirst({ where: { id: messageId, conversationId: id } });
  if (!message) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await prisma.savedMessage.findUnique({
    where: { userId_messageId: { userId, messageId: message.id } },
  });

  if (existing) {
    await prisma.savedMessage.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, saved: false });
  }

  await prisma.savedMessage.create({ data: { userId, messageId: message.id } });
  return NextResponse.json({ ok: true, saved: true });
}
