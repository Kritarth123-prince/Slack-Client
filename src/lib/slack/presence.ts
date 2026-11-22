import type { WebClient } from "@slack/web-api";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSlackClientForInstallation } from "@/lib/slack/client";
import { getActiveInstallation } from "@/lib/slack/installation";
import { logger } from "@/lib/logger";
import { toSlackEmojiCode } from "@/lib/ui/emoji";

// How presence works, and why this module doesn't pretend otherwise: Slack decides whether someone
// is active from activity in *its own* apps, and lets other apps do only two things — pin a user
// "away", or hand presence back to Slack ("auto"). There is no API to mark someone active
// (https://docs.slack.dev/apis/web-api/user-presence-and-status). So "Active" here means
// "automatic", and the menu shows what colleagues actually see, read back from users.getPresence,
// rather than an app-local guess that could disagree with Slack.

const STATUS_TEXT_MAX = 100; // Slack's limit for status_text

export interface StatusView {
  /** What the user chose: "away" pins them away in Slack; "active" leaves presence to Slack (automatic). */
  presence: "active" | "away";
  /** What colleagues see in Slack right now, or null when it couldn't be read. */
  slackPresence: "active" | "away" | null;
  /** Whether any of Slack's own apps is connected for this user (null = unknown). Slack only shows someone active while one is. */
  slackClientConnected: boolean | null;
  doNotDisturb: boolean;
  /** `:shortcode:` as Slack stores it. */
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

/**
 * Applies a change to every workspace this user has connected — the status menu is one control
 * for the whole app, so Away/DND/custom status shouldn't only reach whichever workspace is showing.
 */
async function pushToAllWorkspaces(userId: string, what: string, apply: (client: WebClient) => Promise<unknown>): Promise<SyncResult> {
  const installations = await prisma.slackInstallation.findMany({ where: { userId, revokedAt: null } });
  const results = await Promise.all(
    installations.map(async (installation): Promise<SyncResult> => {
      try {
        await apply(getSlackClientForInstallation(installation));
        return "ok";
      } catch (err) {
        if (isMissingScope(err)) return "missing_scope";
        logger.error(`Failed to sync ${what} to Slack`, { message: (err as Error).message });
        return "error";
      }
    })
  );
  if (results.includes("missing_scope")) return "missing_scope";
  if (results.includes("error")) return "error";
  return "ok";
}

function summarizeSyncResults(results: SyncResult[]): string | null {
  if (results.includes("missing_scope")) {
    return "Couldn't sync to Slack — your connection is missing a permission this needs. Reconnect Slack to grant it.";
  }
  if (results.includes("error")) {
    return "Couldn't sync to Slack right now. Try again in a moment.";
  }
  return null;
}

interface SlackState {
  presence: "active" | "away" | null;
  manualAway: boolean | null;
  connected: boolean | null;
  status: { emoji: string | null; text: string | null; expiresAt: Date | null } | null;
}

/** Reads presence and custom status from Slack for the active workspace. Each half is independent and may be null. */
async function readSlackState(userId: string, options: { status: boolean }): Promise<SlackState> {
  const empty: SlackState = { presence: null, manualAway: null, connected: null, status: null };
  const installation = await getActiveInstallation(userId);
  if (!installation) return empty;
  const client = getSlackClientForInstallation(installation);

  const [presence, profile] = await Promise.all([
    client.users.getPresence({}).catch(() => null),
    options.status ? client.users.profile.get({}).catch(() => null) : Promise.resolve(null),
  ]);

  const expiration = profile?.profile?.status_expiration ?? 0;
  return {
    presence: presence?.presence === "active" ? "active" : presence?.presence === "away" ? "away" : null,
    manualAway: typeof presence?.manual_away === "boolean" ? presence.manual_away : null,
    connected: typeof presence?.connection_count === "number" ? presence.connection_count > 0 : null,
    status: profile?.profile
      ? {
          emoji: profile.profile.status_emoji || null,
          text: profile.profile.status_text || null,
          expiresAt: expiration > 0 ? new Date(expiration * 1000) : null,
        }
      : null,
  };
}

function toView(
  pref: {
    presence: string;
    doNotDisturb: boolean;
    statusEmoji: string | null;
    statusText: string | null;
    statusExpiresAt: Date | null;
  },
  slack: SlackState,
  slackSyncWarning: string | null = null
): StatusView {
  return {
    presence: pref.presence === "away" ? "away" : "active",
    slackPresence: slack.presence,
    slackClientConnected: slack.connected,
    doNotDisturb: pref.doNotDisturb,
    statusEmoji: pref.statusEmoji,
    statusText: pref.statusText,
    statusExpiresAt: pref.statusExpiresAt ? pref.statusExpiresAt.toISOString() : null,
    slackSyncWarning,
  };
}

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Reads the current status. Slack is the source of truth: a custom status, or Away, set or cleared
 * in Slack's own apps is adopted here, so both stay in step. When Slack can't be reached, the last
 * known values are shown, with an expired custom status dropped.
 */
export async function getStatus(userId: string): Promise<StatusView> {
  const [pref, slack] = await Promise.all([
    prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } }),
    readSlackState(userId, { status: true }),
  ]);

  const data: Prisma.UserPreferenceUpdateInput = {};
  const next = { ...pref };

  if (slack.status) {
    const { emoji, text, expiresAt } = slack.status;
    if (emoji !== pref.statusEmoji || text !== pref.statusText || !sameInstant(expiresAt, pref.statusExpiresAt)) {
      data.statusEmoji = next.statusEmoji = emoji;
      data.statusText = next.statusText = text;
      data.statusExpiresAt = next.statusExpiresAt = expiresAt;
    }
  } else if (pref.statusExpiresAt && pref.statusExpiresAt.getTime() <= Date.now()) {
    data.statusEmoji = next.statusEmoji = null;
    data.statusText = next.statusText = null;
    data.statusExpiresAt = next.statusExpiresAt = null;
  }

  if (slack.manualAway !== null && slack.manualAway !== (pref.presence === "away")) {
    next.presence = slack.manualAway ? "away" : "active";
    data.presence = next.presence;
    data.presenceManual = slack.manualAway;
  }

  if (Object.keys(data).length > 0) await prisma.userPreference.update({ where: { userId }, data });
  return toView(next, slack);
}

export interface UpdateStatusInput {
  presence?: "active" | "away"; // "away" pins Slack presence away; "active" hands it back to Slack (automatic)
  doNotDisturb?: boolean;
  statusEmoji?: string | null;
  statusText?: string | null;
  statusExpiresAt?: string | null; // ISO string, or null to never clear
  clearStatus?: boolean;
}

function parseExpiry(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now() ? null : date;
}

export async function updateStatus(userId: string, input: UpdateStatusInput): Promise<StatusView> {
  const current = await prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } });

  const data: Prisma.UserPreferenceUpdateInput = {};
  if (input.presence) {
    data.presence = input.presence;
    data.presenceManual = input.presence === "away";
  }
  if (typeof input.doNotDisturb === "boolean") data.doNotDisturb = input.doNotDisturb;

  const statusChanged =
    input.clearStatus || input.statusEmoji !== undefined || input.statusText !== undefined || input.statusExpiresAt !== undefined;
  if (input.clearStatus) {
    data.statusEmoji = null;
    data.statusText = null;
    data.statusExpiresAt = null;
  } else {
    if (input.statusEmoji !== undefined) data.statusEmoji = toSlackEmojiCode(input.statusEmoji) || null;
    if (input.statusText !== undefined) data.statusText = input.statusText?.trim().slice(0, STATUS_TEXT_MAX) || null;
    if (input.statusExpiresAt !== undefined) data.statusExpiresAt = parseExpiry(input.statusExpiresAt);
  }

  const pref = Object.keys(data).length > 0 ? await prisma.userPreference.update({ where: { userId }, data }) : current;

  const pushes: Promise<SyncResult>[] = [];
  if (input.presence) {
    const presence = input.presence === "away" ? "away" : "auto";
    pushes.push(pushToAllWorkspaces(userId, "presence", (client) => client.users.setPresence({ presence })));
  }
  if (typeof input.doNotDisturb === "boolean") {
    const enable = input.doNotDisturb;
    pushes.push(
      pushToAllWorkspaces(userId, "Do Not Disturb", (client) =>
        enable
          ? client.dnd.setSnooze({ num_minutes: 24 * 60 })
          : client.dnd.endSnooze().catch((err) => {
              // Already off in that workspace (e.g. the 24h snooze ran out) — nothing to undo.
              if ((err as { data?: { error?: string } }).data?.error !== "snooze_not_active") throw err;
            })
      )
    );
  }
  if (statusChanged) {
    const profile = {
      status_text: pref.statusText ?? "",
      status_emoji: toSlackEmojiCode(pref.statusEmoji),
      status_expiration: pref.statusExpiresAt ? Math.floor(pref.statusExpiresAt.getTime() / 1000) : 0,
    };
    pushes.push(pushToAllWorkspaces(userId, "custom status", (client) => client.users.profile.set({ profile })));
  }
  const results = await Promise.all(pushes);

  // Read presence back so the menu shows what Slack made of the change straight away.
  const slack = await readSlackState(userId, { status: false });
  return toView(pref, slack, summarizeSyncResults(results));
}
