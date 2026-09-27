import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const env = getEnv();
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

function minutesNowIn(timezone: string | null): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone ?? undefined,
    }).formatToParts(new Date());
  } catch {
    // unknown zone string — fall back to the server clock rather than silently muting everything
    parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function inQuietHours(start: string | null, end: string | null, timezone: string | null): boolean {
  if (!start || !end) return false;
  const now = minutesNowIn(timezone);
  const from = toMinutes(start);
  const to = toMinutes(end);
  // A window like 22:00–07:00 wraps past midnight.
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

export interface NotificationContext {
  conversationType: "PUBLIC_CHANNEL" | "PRIVATE_CHANNEL" | "DM" | "GROUP_DM";
  text: string;
  selfSlackUserId: string;
  isThreadReply: boolean;
}

/**
 * Applies the user's notification preferences (DND, quiet hours, and which kinds of message
 * should notify) to one incoming message. Mentions win over the per-conversation-type toggles,
 * so an @-mention in a muted channel still gets through when mentions are on.
 */
export async function notificationAllowed(userId: string, ctx: NotificationContext): Promise<boolean> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } });
  if (!pref) return true;
  if (pref.doNotDisturb) return false;
  if (inQuietHours(pref.quietHoursStart, pref.quietHoursEnd, pref.timezone)) return false;

  const isMention = ctx.text.includes(`<@${ctx.selfSlackUserId}>`) || /<!(here|channel|everyone)>/.test(ctx.text);
  if (isMention) return pref.notifyMentions;
  if (ctx.isThreadReply) return pref.notifyThreadReplies;
  if (ctx.conversationType === "DM" || ctx.conversationType === "GROUP_DM") return pref.notifyDirectMessages;
  return pref.notifyChannelMessages;
}

/** Sends a web push notification to every device the given user has subscribed from. */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url: string }
): Promise<void> {
  ensureConfigured();

  const subscriptions = await prisma.notificationSubscription.findMany({
    where: { userId, disabledAt: null },
  });
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
        await prisma.notificationSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: new Date() } });
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone (browser data cleared, notifications revoked, etc.) — stop trying it.
          await prisma.notificationSubscription.update({ where: { id: sub.id }, data: { disabledAt: new Date() } });
        } else {
          logger.error("Failed to send push notification", { message: (err as Error).message, statusCode });
        }
      }
    })
  );
}
