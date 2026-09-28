import { prisma } from "@/lib/db/prisma";
import { getSlackClientForWorkspace } from "@/lib/slack/client";
import { getActiveInstallation } from "@/lib/slack/installation";
import { logger } from "@/lib/logger";

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export interface WorkspaceBranding {
  name: string;
  domain: string | null;
  iconUrl: string | null;
}

/**
 * Pulls the workspace's real name/icon via team.info. Only refreshes when the icon has never been
 * fetched or the row is a day old, so this doesn't add a Slack call to every conversation-list load.
 */
export async function syncWorkspaceBranding(userId: string): Promise<void> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return;

  const { workspace } = installation;
  const fresh = workspace.iconUrl && Date.now() - workspace.updatedAt.getTime() < REFRESH_AFTER_MS;
  if (fresh) return;

  try {
    const client = await getSlackClientForWorkspace(userId, workspace.id);
    const res = await client.team.info();
    const team = res.team;
    if (!team) return;

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        name: team.name ?? workspace.name,
        domain: team.domain ?? workspace.domain,
        iconUrl: team.icon?.image_132 ?? team.icon?.image_88 ?? workspace.iconUrl,
      },
    });
  } catch (err) {
    logger.warn("Failed to refresh workspace branding", { message: (err as Error).message });
  }
}

export async function getWorkspaceBranding(userId: string): Promise<WorkspaceBranding | null> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return null;

  const { workspace } = installation;
  return { name: workspace.name, domain: workspace.domain, iconUrl: workspace.iconUrl };
}
