import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getConversationSetting, updateConversationSetting } from "@/server/services/conversationSettings";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json(await getConversationSetting(userId, id));
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { pinned?: unknown; muted?: unknown } | null;
  const input = {
    ...(typeof body?.pinned === "boolean" ? { pinned: body.pinned } : {}),
    ...(typeof body?.muted === "boolean" ? { muted: body.muted } : {}),
  };
  return NextResponse.json(await updateConversationSetting(userId, id, input));
}
