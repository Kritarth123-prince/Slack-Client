import { prisma } from "@/lib/db/prisma";
import { getSlackClientForWorkspace } from "@/lib/slack/client";
import { getActiveInstallation } from "@/lib/slack/installation";
import { logger } from "@/lib/logger";

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Pulls the workspace's custom emoji (emoji.list) into CustomEmoji at most once a day. Slack
 * returns aliases as "alias:target"; those are resolved to the target's image so callers only
 * ever see name → url. Silently skipped when the token lacks emoji:read.
 */
export async function syncCustomEmoji(userId: string): Promise<void> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return;
  const { workspace } = installation;
  if (workspace.emojiSyncedAt && Date.now() - workspace.emojiSyncedAt.getTime() < REFRESH_AFTER_MS) return;

  let list: Record<string, string>;
  try {
    const client = await getSlackClientForWorkspace(userId, workspace.id);
    const res = await client.emoji.list();
    list = (res.emoji ?? {}) as Record<string, string>;
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    if (code !== "missing_scope") logger.warn("Failed to sync custom emoji", { message: (err as Error).message });
    return;
  }

  const resolved = new Map<string, string>();
  for (const [name, value] of Object.entries(list)) {
    if (!value.startsWith("alias:")) resolved.set(name, value);
  }
  for (const [name, value] of Object.entries(list)) {
    if (value.startsWith("alias:")) {
      const target = resolved.get(value.slice("alias:".length));
      if (target) resolved.set(name, target);
    }
  }

  await prisma.$transaction([
    prisma.customEmoji.deleteMany({ where: { workspaceId: workspace.id, name: { notIn: [...resolved.keys()] } } }),
    ...[...resolved].map(([name, url]) =>
      prisma.customEmoji.upsert({
        where: { workspaceId_name: { workspaceId: workspace.id, name } },
        update: { url },
        create: { workspaceId: workspace.id, name, url },
      })
    ),
    prisma.workspace.update({ where: { id: workspace.id }, data: { emojiSyncedAt: new Date() } }),
  ]);
}

/** name → image url for the active workspace's custom emoji. */
export async function getCustomEmojiMap(userId: string): Promise<Record<string, string>> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return {};
  const rows = await prisma.customEmoji.findMany({ where: { workspaceId: installation.workspaceId } });
  return Object.fromEntries(rows.map((r) => [r.name, r.url]));
}
