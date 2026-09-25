import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { editMessage, deleteMessage } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

async function loadOwnMessage(userId: string, conversationId: string, messageId: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;

  const message = await prisma.message.findFirst({ where: { id: messageId, conversationId: conversation.id } });
  if (!message) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;

  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return { error: NextResponse.json({ error: "not_connected" }, { status: 409 }) } as const;

  const self = await prisma.slackUser.findUnique({
    where: { workspaceId_slackUserId: { workspaceId: conversation.workspaceId, slackUserId: installation.slackUserId } },
  });
  if (!self || message.authorId !== self.id) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  return { conversation, message } as const;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, messageId } = await params;
  const loaded = await loadOwnMessage(userId, id, messageId);
  if ("error" in loaded) return loaded.error;

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });

  try {
    await editMessage(userId, loaded.conversation, loaded.message, text);
  } catch (err) {
    logger.error("Failed to edit message", { message: (err as Error).message });
    return NextResponse.json({ error: "edit_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, messageId } = await params;
  const loaded = await loadOwnMessage(userId, id, messageId);
  if ("error" in loaded) return loaded.error;

  try {
    await deleteMessage(userId, loaded.conversation, loaded.message);
  } catch (err) {
    logger.error("Failed to delete message", { message: (err as Error).message });
    return NextResponse.json({ error: "delete_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
