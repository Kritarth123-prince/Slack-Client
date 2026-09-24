import { NextRequest, NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { getEnv } from "@/lib/env";
import { getSession, createUserSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { encryptToken } from "@/lib/slack/tokenCipher";
import { logger } from "@/lib/logger";
import { SLACK_USER_SCOPES } from "@/lib/slack/scopes";

// Every failure redirects to a single UI route with a `?error=` code the
// login page renders as a specific, actionable message (see
// src/app/(marketing)/login/page.tsx) rather than a raw stack trace.
function errorRedirect(baseUrl: string, code: string) {
  return NextResponse.redirect(`${baseUrl}/login?error=${encodeURIComponent(code)}`);
}

export async function GET(request: NextRequest) {
  const env = getEnv();
  const { searchParams } = new URL(request.url);

  const error = searchParams.get("error");
  if (error) {
    // Most commonly "access_denied" — the user clicked Cancel on Slack's screen.
    logger.info("Slack OAuth denied or cancelled", { error });
    return errorRedirect(env.APP_BASE_URL, error === "access_denied" ? "oauth_cancelled" : "oauth_error");
  }

  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");

  const session = await getSession();
  const expectedState = session.oauthState;
  session.oauthState = undefined;
  await session.save();

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    logger.warn("Slack OAuth state mismatch or missing code");
    return errorRedirect(env.APP_BASE_URL, "invalid_state");
  }

  const client = new WebClient();

  let result;
  try {
    result = await client.oauth.v2.access({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_BASE_URL}/api/oauth/slack/callback`,
    });
  } catch (err) {
    logger.error("Slack OAuth token exchange failed", { message: (err as Error).message });
    return errorRedirect(env.APP_BASE_URL, "oauth_error");
  }

  if (!result.ok || !result.authed_user?.access_token || !result.team?.id) {
    logger.error("Slack OAuth response missing expected fields", { ok: result.ok });
    return errorRedirect(env.APP_BASE_URL, "oauth_error");
  }

  const grantedScopes = (result.authed_user.scope ?? "").split(",").filter(Boolean);
  const missingScopes = SLACK_USER_SCOPES.filter((scope) => !grantedScopes.includes(scope));
  if (missingScopes.length > 0) {
    // Slack allows a user to deselect scopes on some app configurations;
    // treat a partial grant as insufficient rather than silently degrading.
    logger.warn("Slack OAuth granted insufficient scopes", { missingScopes });
    return errorRedirect(env.APP_BASE_URL, "insufficient_scope");
  }

  const teamId = result.team.id;
  const teamName = result.team.name ?? teamId;
  const slackUserId = result.authed_user.id!;

  const workspace = await prisma.workspace.upsert({
    where: { slackTeamId: teamId },
    update: { name: teamName },
    create: { slackTeamId: teamId, name: teamName },
  });

  const existingInstallation = await prisma.slackInstallation.findUnique({
    where: { workspaceId_slackUserId: { workspaceId: workspace.id, slackUserId } },
  });

  const userId = existingInstallation?.userId ?? (await prisma.user.create({ data: {} })).id;

  const { ciphertext, iv, authTag } = encryptToken(result.authed_user.access_token);

  await prisma.slackInstallation.upsert({
    where: { workspaceId_slackUserId: { workspaceId: workspace.id, slackUserId } },
    update: {
      encryptedAccessToken: ciphertext,
      tokenIv: iv,
      tokenAuthTag: authTag,
      scopes: grantedScopes.join(" "),
      revokedAt: null,
    },
    create: {
      userId,
      workspaceId: workspace.id,
      slackUserId,
      encryptedAccessToken: ciphertext,
      tokenIv: iv,
      tokenAuthTag: authTag,
      scopes: grantedScopes.join(" "),
      botUserId: result.bot_user_id ?? null,
    },
  });

  await prisma.userPreference.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  await createUserSession(userId, {
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  logger.info("Slack OAuth completed", { teamId, slackUserId });

  return NextResponse.redirect(`${env.APP_BASE_URL}/app`);
}
