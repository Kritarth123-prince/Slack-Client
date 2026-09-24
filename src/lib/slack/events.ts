import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const MAX_CLOCK_SKEW_SECONDS = 60 * 5;

/**
 * Verifies a Slack Events API request signature per
 * https://api.slack.com/authentication/verifying-requests-from-slack.
 * Requires the RAW request body (before JSON parsing) because the
 * signature is computed over the exact bytes Slack sent.
 */
export function verifySlackSignature(params: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
}): boolean {
  const { rawBody, timestampHeader, signatureHeader } = params;
  if (!timestampHeader || !signatureHeader) return false;

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    logger.warn("Rejected Slack event: timestamp outside allowed skew", { timestamp });
    return false;
  }

  const signingSecret = getEnv().SLACK_SIGNING_SECRET;
  const baseString = `v0:${timestampHeader}:${rawBody}`;
  const computedSignature = `v0=${crypto.createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;

  const expected = Buffer.from(computedSignature, "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");
  if (expected.length !== actual.length) return false;

  return crypto.timingSafeEqual(expected, actual);
}

export interface SlackEventEnvelope {
  type: "url_verification" | "event_callback";
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: {
    type: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    subtype?: string;
    reaction?: string;
    item?: { channel?: string; ts?: string };
    item_user?: string;
    deleted_ts?: string;
    message?: { ts?: string; text?: string; user?: string; thread_ts?: string };
    [key: string]: unknown;
  };
}
