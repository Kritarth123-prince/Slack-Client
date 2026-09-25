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
