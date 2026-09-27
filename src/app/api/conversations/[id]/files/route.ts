import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { uploadFile } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

// Slack itself allows much larger files, but reading the whole upload into a Buffer in this route
// means memory scales with whatever's allowed here — 25 MB keeps that bounded and comfortably
// covers file attachments and voice notes alike.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "empty_file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "file_too_large" }, { status: 413 });

  const threadTsField = form.get("threadTs");
  const threadTs = typeof threadTsField === "string" && threadTsField ? threadTsField : undefined;
  const commentField = form.get("initialComment");
  const initialComment = typeof commentField === "string" && commentField.trim() ? commentField.trim() : undefined;

  try {
    const data = Buffer.from(await file.arrayBuffer());
    await uploadFile(userId, conversation, {
      data,
      filename: file.name || "file",
      threadTs,
      initialComment,
    });
  } catch (err) {
    const slackErrorCode = (err as { data?: { error?: string } }).data?.error;
    logger.error("Failed to upload file to Slack", {
      message: (err as Error).message,
      slackErrorCode,
    });

    if (slackErrorCode === "missing_scope") {
      return NextResponse.json(
        { error: "missing_scope", message: "Reconnect your Slack account to enable file/voice-note uploads." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: "upload_failed", slackErrorCode }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
