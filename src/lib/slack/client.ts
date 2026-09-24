import { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/db/prisma";
import { decryptToken } from "@/lib/slack/tokenCipher";
import { logger } from "@/lib/logger";

/**
 * Builds a Slack WebClient authenticated as the given user's installation.
 * The decrypted token lives only in process memory for the duration of
 * the request — it is never returned to the caller or logged.
 */
export async function getSlackClientForUser(userId: string): Promise<WebClient> {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });

  if (!installation) {
    throw new SlackNotConnectedError(userId);
  }

  const token = decryptToken({
    ciphertext: installation.encryptedAccessToken,
    iv: installation.tokenIv,
    authTag: installation.tokenAuthTag,
  });

  const client = new WebClient(token, {
    retryConfig: { retries: 4, factor: 2, minTimeout: 500, maxTimeout: 8000 },
  });

  return client;
}

export class SlackNotConnectedError extends Error {
  constructor(userId: string) {
    super(`No active Slack installation for user ${userId}`);
    this.name = "SlackNotConnectedError";
  }
}

/**
 * Wraps a Slack API call, translating token revocation into a typed error
 * the caller can use to prompt reauthorization instead of surfacing a raw
 * Slack API error to the UI.
 */
export async function callSlack<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const slackError = error as { data?: { error?: string }; code?: string };
    const code = slackError.data?.error;

    if (code === "token_revoked" || code === "account_inactive" || code === "invalid_auth") {
      logger.warn("Slack token no longer valid", { code });
      throw new SlackTokenRevokedError(code);
    }

    if (code === "missing_scope") {
      logger.warn("Slack call missing required scope", { code });
      throw new SlackMissingScopeError(code);
    }

    throw error;
  }
}

export class SlackTokenRevokedError extends Error {
  constructor(public readonly slackErrorCode: string) {
    super(`Slack credentials are no longer valid (${slackErrorCode})`);
    this.name = "SlackTokenRevokedError";
  }
}

export class SlackMissingScopeError extends Error {
  constructor(public readonly slackErrorCode: string) {
    super(`Slack denied the request due to a missing OAuth scope`);
    this.name = "SlackMissingScopeError";
  }
}
