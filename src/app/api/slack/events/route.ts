import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, type SlackEventEnvelope } from "@/lib/slack/events";
import { processSlackEvent } from "@/lib/slack/sync";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const verified = verifySlackSignature({
    rawBody,
    timestampHeader: request.headers.get("x-slack-request-timestamp"),
    signatureHeader: request.headers.get("x-slack-signature"),
  });
  if (!verified) {
    logger.warn("Rejected Slack event: invalid signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const envelope = JSON.parse(rawBody) as SlackEventEnvelope;

  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (envelope.type === "event_callback" && envelope.event_id && envelope.event) {
    try {
      await prisma.processedSlackEvent.create({
        data: { id: envelope.event_id, eventType: envelope.event.type },
      });
    } catch {
      // Unique constraint violation: this delivery (retry) was already processed.
      return NextResponse.json({ ok: true });
    }

    try {
      await processSlackEvent(envelope);
    } catch (err) {
      logger.error("Failed to process Slack event", {
        message: (err as Error).message,
        eventType: envelope.event.type,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
