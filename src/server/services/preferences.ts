import { prisma } from "@/lib/db/prisma";
import { getSlackClientForUser } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

export interface PreferencesView {
  displayName: string;
  theme: Theme;
  density: Density;
  notifyDirectMessages: boolean;
  notifyMentions: boolean;
  notifyThreadReplies: boolean;
  notifyChannelMessages: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  timezone: string | null;
  /** Non-null when a change couldn't be pushed to real Slack (e.g. the display name), mirroring StatusView. */
  slackSyncWarning: string | null;
}

export interface UpdatePreferencesInput {
  displayName?: string;
  theme?: Theme;
  density?: Density;
  notifyDirectMessages?: boolean;
  notifyMentions?: boolean;
  notifyThreadReplies?: boolean;
  notifyChannelMessages?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone?: string | null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

async function selfSlackUser(userId: string) {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return null;
  return prisma.slackUser.findUnique({
    where: {
      workspaceId_slackUserId: { workspaceId: installation.workspaceId, slackUserId: installation.slackUserId },
    },
  });
}

export async function getPreferences(userId: string): Promise<PreferencesView> {
  const [pref, self] = await Promise.all([
    prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } }),
    selfSlackUser(userId),
  ]);

  return {
    displayName: self?.displayName ?? "",
    theme: pref.theme === "light" || pref.theme === "dark" ? pref.theme : "system",
    density: pref.density === "compact" ? "compact" : "comfortable",
    notifyDirectMessages: pref.notifyDirectMessages,
    notifyMentions: pref.notifyMentions,
    notifyThreadReplies: pref.notifyThreadReplies,
    notifyChannelMessages: pref.notifyChannelMessages,
    quietHoursStart: pref.quietHoursStart,
    quietHoursEnd: pref.quietHoursEnd,
    timezone: pref.timezone,
    slackSyncWarning: null,
  };
}

export async function updatePreferences(userId: string, input: UpdatePreferencesInput): Promise<PreferencesView> {
  const data: Record<string, string | boolean | null> = {};
  if (input.theme) data.theme = input.theme;
  if (input.density) data.density = input.density;
  for (const key of ["notifyDirectMessages", "notifyMentions", "notifyThreadReplies", "notifyChannelMessages"] as const) {
    if (typeof input[key] === "boolean") data[key] = input[key];
  }
  if (input.quietHoursStart !== undefined) data.quietHoursStart = input.quietHoursStart && TIME_RE.test(input.quietHoursStart) ? input.quietHoursStart : null;
  if (input.quietHoursEnd !== undefined) data.quietHoursEnd = input.quietHoursEnd && TIME_RE.test(input.quietHoursEnd) ? input.quietHoursEnd : null;
  if (input.timezone !== undefined) data.timezone = input.timezone || null;

  await prisma.userPreference.upsert({ where: { userId }, update: data, create: { userId, ...data } });

  let slackSyncWarning: string | null = null;
  if (typeof input.displayName === "string") {
    slackSyncWarning = await updateDisplayName(userId, input.displayName.trim());
  }

  const view = await getPreferences(userId);
  return { ...view, slackSyncWarning };
}

/** Pushes a new display name to the user's Slack profile, then mirrors it locally. Returns a warning string when Slack rejected it. */
async function updateDisplayName(userId: string, displayName: string): Promise<string | null> {
  if (!displayName) return "Display name can't be empty.";

  try {
    const client = await getSlackClientForUser(userId);
    await client.users.profile.set({ profile: { display_name: displayName } });
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    logger.warn("Failed to update Slack display name", { code, message: (err as Error).message });
    return code === "missing_scope"
      ? "Couldn't update your display name on Slack — reconnect Slack to grant the profile permission."
      : "Couldn't update your display name on Slack right now.";
  }

  const self = await selfSlackUser(userId);
  if (self) await prisma.slackUser.update({ where: { id: self.id }, data: { displayName } });
  return null;
}
