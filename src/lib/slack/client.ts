import { WebClient } from "@slack/web-api";
import type { SlackInstallation } from "@prisma/client";
import { decryptToken } from "@/lib/slack/tokenCipher";
import { getActiveInstallation, getInstallationForWorkspace } from "@/lib/slack/installation";
import { logger } from "@/lib/logger";

function clientFor(installation: SlackInstallation): WebClient {
  const token = decryptToken({
    ciphertext: installation.encryptedAccessToken,
    iv: installation.tokenIv,
    authTag: installation.tokenAuthTag,
  });
  return new WebClient(token, {
    retryConfig: { retries: 4, factor: 2, minTimeout: 500, maxTimeout: 8000 },
  });
}

/**
 * Builds a Slack WebClient for a specific installation. The decrypted token lives only in process
 * memory for the duration of the request — it is never returned to the caller or logged.
 */
export function getSlackClientForInstallation(installation: SlackInstallation): WebClient {
  return clientFor(installation);
}

/** A client for the user's currently active workspace (see getActiveInstallation). */
export async function getSlackClientForUser(userId: string): Promise<WebClient> {
  const installation = await getActiveInstallation(userId);
  if (!installation) throw new SlackNotConnectedError(userId);
  return clientFor(installation);
}

/**
 * A client for a specific workspace — used whenever the action is about a conversation, since the
 * conversation's workspace may not be the one the user currently has switched to.
 */
export async function getSlackClientForWorkspace(userId: string, workspaceId: string): Promise<WebClient> {
  const installation = await getInstallationForWorkspace(userId, workspaceId);
  if (!installation) throw new SlackNotConnectedError(userId);
  return clientFor(installation);
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
