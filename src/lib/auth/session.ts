import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";

export interface SessionData {
  userId?: string;
  sessionRecordId?: string;
  oauthState?: string; // CSRF/state token for an in-flight Slack OAuth handshake
}

function sessionOptions(): SessionOptions {
  return {
    password: getEnv().SESSION_SECRET,
    cookieName: "slack_web_session",
    cookieOptions: {
      httpOnly: true,
      secure: getEnv().NODE_ENV === "production",
      sameSite: "lax",
      // 30 days; the underlying Session DB row is the real source of
      // truth and can be revoked independently of the cookie's lifetime.
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Creates a revocable server-side session row and stores its id in the encrypted cookie. */
export async function createUserSession(
  userId: string,
  meta: { userAgent?: string; ipHash?: string }
): Promise<void> {
  const record = await prisma.session.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: meta.userAgent,
      ipHash: meta.ipHash,
    },
  });

  const session = await getSession();
  session.userId = userId;
  session.sessionRecordId = record.id;
  await session.save();
}

/** Returns the authenticated user's id, validating the session row is still live (not revoked/expired). */
export async function requireUserId(): Promise<string | null> {
  const session = await getSession();
  if (!session.userId || !session.sessionRecordId) return null;

  const record = await prisma.session.findUnique({ where: { id: session.sessionRecordId } });
  if (!record || record.expiresAt < new Date()) {
    await session.destroy();
    return null;
  }

  return session.userId;
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  if (session.sessionRecordId) {
    await prisma.session.delete({ where: { id: session.sessionRecordId } }).catch(() => {
      // already gone — fine, we're deleting it anyway
    });
  }
  await session.destroy();
}
