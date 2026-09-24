import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getEnv } from "@/lib/env";
import { getSession } from "@/lib/auth/session";
import { SLACK_SCOPES_STRING } from "@/lib/slack/scopes";

/**
 * Starts the "Add to Slack" / Sign in with Slack handshake.
 * Generates a random state value, stores it in the (encrypted, HttpOnly)
 * session cookie, and redirects the browser to Slack's authorize screen.
 * The callback route verifies the returned state matches before trusting
 * anything else in the response, which is what prevents CSRF on OAuth.
 */
export async function GET() {
  const env = getEnv();
  const state = crypto.randomBytes(24).toString("hex");

  const session = await getSession();
  session.oauthState = state;
  await session.save();

  const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizeUrl.searchParams.set("client_id", env.SLACK_CLIENT_ID);
  authorizeUrl.searchParams.set("user_scope", SLACK_SCOPES_STRING);
  authorizeUrl.searchParams.set("redirect_uri", `${env.APP_BASE_URL}/api/oauth/slack/callback`);
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl.toString());
}
