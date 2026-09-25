import { prisma } from "@/lib/db/prisma";
import { getSlackClientForUser } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

const AUTO_AWAY_MINUTES = 10;

export interface StatusView {
  presence: "active" | "away";
  presenceManual: boolean;
  autoAwayEnabled: boolean;
  doNotDisturb: boolean;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  /** Non-null when the most recent change couldn't be pushed to real Slack — surfaced to the UI
   * instead of failing silently, since a missing scope otherwise looks identical to "it worked". */
  slackSyncWarning: string | null;
}

type SyncResult = "ok" | "missing_scope" | "error";

function isMissingScope(err: unknown): boolean {
  return (err as { data?: { error?: string } }).data?.error === "missing_scope";
}

/** Pushes the active/away presence to Slack. Best-effort: a pre-reconnect installation may not
 * yet have the `users:write` scope, in which case this app's own state still applies locally. */
async function syncPresenceToSlack(userId: string, presence: "active" | "away"): Promise<SyncResult> {
  try {
    const client = await getSlackClientForUser(userId);
    await client.users.setPresence({ presence: presence === "away" ? "away" : "auto" });
    return "ok";
  } catch (err) {
    if (isMissingScope(err)) return "missing_scope";
    logger.error("Failed to sync presence to Slack", { message: (err as Error).message });
    return "error";
  }
}

/** Pushes the custom status to Slack (clearing it when both emoji and text are empty). */
async function syncCustomStatusToSlack(
  userId: string,
  emoji: string | null,
  text: string | null,
  expiresAt: Date | null
): Promise<SyncResult> {
  try {
    const client = await getSlackClientForUser(userId);
    await client.users.profile.set({
      profile: {
        status_text: text ?? "",
        status_emoji: emoji ?? "",
        status_expiration: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0,
      },
    });
    return "ok";
  } catch (err) {
    if (isMissingScope(err)) return "missing_scope";
    logger.error("Failed to sync custom status to Slack", { message: (err as Error).message });
    return "error";
  }
}

/** Turns Slack's own Do Not Disturb snooze on/off. Mirrors the local toggle used to mute this
 * app's own push notifications, so DND set here matches what other people see on real Slack. */
async function syncDndToSlack(userId: string, enabled: boolean): Promise<SyncResult> {
  try {
    const client = await getSlackClientForUser(userId);
    if (enabled) await client.dnd.setSnooze({ num_minutes: 24 * 60 });
    else await client.dnd.endSnooze();
    return "ok";
  } catch (err) {
    if (isMissingScope(err)) return "missing_scope";
    logger.error("Failed to sync Do Not Disturb to Slack", { message: (err as Error).message });
    return "error";
  }
}

function summarizeSyncResults(results: SyncResult[]): string | null {
  if (results.includes("missing_scope")) {
    return "Couldn't sync to Slack — reconnect your Slack account (Settings → Connect Slack) to grant the new permissions this needs.";
  }
  if (results.includes("error")) {
    return "Couldn't sync to Slack right now — it may catch up on the next update.";
  }
  return null;
}

function toView(
  pref: {
    presence: string;
    presenceManual: boolean;
    autoAwayEnabled: boolean;
    doNotDisturb: boolean;
    statusEmoji: string | null;
    statusText: string | null;
    statusExpiresAt: Date | null;
  },
  slackSyncWarning: string | null = null
): StatusView {
  return {
    presence: pref.presence === "away" ? "away" : "active",
    presenceManual: pref.presenceManual,
    autoAwayEnabled: pref.autoAwayEnabled,
    doNotDisturb: pref.doNotDisturb,
    statusEmoji: pref.statusEmoji,
    statusText: pref.statusText,
    statusExpiresAt: pref.statusExpiresAt ? pref.statusExpiresAt.toISOString() : null,
    slackSyncWarning,
  };
}

/**
 * Reads the current status, lazily applying anything time-based: a custom status past its
 * expiration is cleared, and — when auto-away is on and the user hasn't manually pinned a value —
 * presence flips to "away" once `lastActiveAt` is old enough. Doing this lazily on read (rather
 * than via a cron) is what keeps this consistent with the rest of the app's polling-based design.
 */
export async function getStatus(userId: string): Promise<StatusView> {
  const pref = await prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } });

  const data: Partial<{
    presence: string;
    statusEmoji: string | null;
    statusText: string | null;
    statusExpiresAt: Date | null;
  }> = {};

  let presence = pref.presence;
  let statusEmoji = pref.statusEmoji;
  let statusText = pref.statusText;
  let statusExpiresAt = pref.statusExpiresAt;

  if (statusExpiresAt && statusExpiresAt.getTime() <= Date.now()) {
    statusEmoji = null;
    statusText = null;
    statusExpiresAt = null;
    data.statusEmoji = null;
    data.statusText = null;
    data.statusExpiresAt = null;
  }

  if (pref.autoAwayEnabled && !pref.presenceManual) {
    const inactiveMs = Date.now() - pref.lastActiveAt.getTime();
    const wanted = inactiveMs > AUTO_AWAY_MINUTES * 60_000 ? "away" : "active";
    if (wanted !== presence) {
      presence = wanted;
      data.presence = wanted;
    }
  }

  let slackSyncWarning: string | null = null;
  if (Object.keys(data).length > 0) {
    await prisma.userPreference.update({ where: { userId }, data });
    const results: SyncResult[] = [];
    if (data.presence) results.push(await syncPresenceToSlack(userId, data.presence as "active" | "away"));
    if ("statusEmoji" in data) results.push(await syncCustomStatusToSlack(userId, null, null, null));
    slackSyncWarning = summarizeSyncResults(results);
  }

  return toView({ ...pref, presence, statusEmoji, statusText, statusExpiresAt }, slackSyncWarning);
}

/**
 * Records that the user did something in the app just now. If they're currently auto-away (not
 * manually pinned), this brings them back to Active — the equivalent of Slack noticing you're
 * back at your desk.
 */
export async function recordActivity(userId: string): Promise<void> {
  const pref = await prisma.userPreference.upsert({
    where: { userId },
    update: { lastActiveAt: new Date() },
    create: { userId, lastActiveAt: new Date() },
  });

  if (!pref.presenceManual && pref.presence !== "active") {
    await prisma.userPreference.update({ where: { userId }, data: { presence: "active" } });
    await syncPresenceToSlack(userId, "active");
  }
}

export interface UpdateStatusInput {
  presence?: "active" | "away"; // manual: "away" pins it; "active" clears any pin and resets the inactivity clock
  autoAwayEnabled?: boolean;
  doNotDisturb?: boolean;
  statusEmoji?: string | null;
  statusText?: string | null;
  statusExpiresAt?: string | null; // ISO string, or null to never clear
  clearStatus?: boolean;
}

export async function updateStatus(userId: string, input: UpdateStatusInput): Promise<StatusView> {
  await prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } });

  const data: {
    presence?: string;
    presenceManual?: boolean;
    lastActiveAt?: Date;
    autoAwayEnabled?: boolean;
    doNotDisturb?: boolean;
    statusEmoji?: string | null;
    statusText?: string | null;
    statusExpiresAt?: Date | null;
  } = {};

  if (input.presence === "away") {
    data.presence = "away";
    data.presenceManual = true;
  } else if (input.presence === "active") {
    data.presence = "active";
    data.presenceManual = false;
    data.lastActiveAt = new Date();
  }

  if (typeof input.autoAwayEnabled === "boolean") data.autoAwayEnabled = input.autoAwayEnabled;
  if (typeof input.doNotDisturb === "boolean") data.doNotDisturb = input.doNotDisturb;

  if (input.clearStatus) {
    data.statusEmoji = null;
    data.statusText = null;
    data.statusExpiresAt = null;
  } else {
    if (input.statusEmoji !== undefined) data.statusEmoji = input.statusEmoji || null;
    if (input.statusText !== undefined) data.statusText = input.statusText || null;
    if (input.statusExpiresAt !== undefined) {
      data.statusExpiresAt = input.statusExpiresAt ? new Date(input.statusExpiresAt) : null;
    }
  }

  const pref = await prisma.userPreference.update({ where: { userId }, data });

  const results: SyncResult[] = [];
  if (data.presence) results.push(await syncPresenceToSlack(userId, pref.presence as "active" | "away"));
  if (typeof input.doNotDisturb === "boolean") results.push(await syncDndToSlack(userId, input.doNotDisturb));
  if (input.clearStatus || input.statusEmoji !== undefined || input.statusText !== undefined || input.statusExpiresAt !== undefined) {
    results.push(await syncCustomStatusToSlack(userId, pref.statusEmoji, pref.statusText, pref.statusExpiresAt));
  }

  return toView(pref, summarizeSyncResults(results));
}

/** Cheap local-only check used by the notification path — doesn't touch Slack, just whether this
 * app should push a notification to the user's devices right now. */
export async function isDoNotDisturb(userId: string): Promise<boolean> {
  const pref = await prisma.userPreference.findUnique({ where: { userId }, select: { doNotDisturb: true } });
  return pref?.doNotDisturb ?? false;
}
