import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function threadTsFrom(value: string | null): string {
  return value ?? "";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const threadTs = threadTsFrom(request.nextUrl.searchParams.get("threadTs"));

  const draft = await prisma.draft.findUnique({
    where: { userId_conversationId_threadTs: { userId, conversationId: id, threadTs } },
  });

  return NextResponse.json({ text: draft?.text ?? "" });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; threadTs?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const threadTs = typeof body?.threadTs === "string" ? body.threadTs : "";

  if (!text.trim()) {
    await prisma.draft.deleteMany({ where: { userId, conversationId: id, threadTs } });
    return NextResponse.json({ ok: true });
  }

  await prisma.draft.upsert({
    where: { userId_conversationId_threadTs: { userId, conversationId: id, threadTs } },
    update: { text },
    create: { userId, conversationId: id, threadTs, text },
  });

  return NextResponse.json({ ok: true });
}
