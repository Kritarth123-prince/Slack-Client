import type { SlackInstallation, Workspace } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type InstallationWithWorkspace = SlackInstallation & { workspace: Workspace };

/**
 * The installation the app should act through for this user right now: the workspace they last
 * switched to, or the most recently connected one. Every "which token do I use" question goes
 * through here so switching workspaces is a single field change on the user row.
 */
export async function getActiveInstallation(userId: string): Promise<InstallationWithWorkspace | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      installations: {
        where: { revokedAt: null },
        include: { workspace: true },
        orderBy: { installedAt: "desc" },
      },
    },
  });
  if (!user || user.installations.length === 0) return null;
  return user.installations.find((i) => i.workspaceId === user.activeWorkspaceId) ?? user.installations[0];
}

/** The installation for a specific workspace — used when acting on a conversation, whose workspace may not be the active one. */
export async function getInstallationForWorkspace(
  userId: string,
  workspaceId: string
): Promise<InstallationWithWorkspace | null> {
  return prisma.slackInstallation.findFirst({
    where: { userId, workspaceId, revokedAt: null },
    include: { workspace: true },
    orderBy: { installedAt: "desc" },
  });
}

export interface WorkspaceOption {
  id: string;
  name: string;
  domain: string | null;
  iconUrl: string | null;
  active: boolean;
}

export async function listWorkspaces(userId: string): Promise<WorkspaceOption[]> {
  const [active, installations] = await Promise.all([
    getActiveInstallation(userId),
    prisma.slackInstallation.findMany({
      where: { userId, revokedAt: null },
      include: { workspace: true },
      orderBy: { installedAt: "asc" },
    }),
  ]);
  return installations.map((i) => ({
    id: i.workspaceId,
    name: i.workspace.name,
    domain: i.workspace.domain,
    iconUrl: i.workspace.iconUrl,
    active: i.workspaceId === active?.workspaceId,
  }));
}

export async function setActiveWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const installation = await getInstallationForWorkspace(userId, workspaceId);
  if (!installation) return false;
  await prisma.user.update({ where: { id: userId }, data: { activeWorkspaceId: workspaceId } });
  return true;
}
