import type { Conversation, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * The `where` clause that limits a conversation lookup to workspaces this user has a live Slack
 * connection to. A conversation id on its own isn't a permission check: the message cache is shared
 * by everyone signed in to this deployment, so without this anyone could read another workspace's
 * messages by guessing (or being sent) an id.
 */
export function accessibleConversationWhere(userId: string, conversationId: string): Prisma.ConversationWhereInput {
  return {
    id: conversationId,
    workspace: { installations: { some: { userId, revokedAt: null } } },
  };
}

/** Loads a conversation only if this user can see its workspace — every conversation route goes through here. */
export async function getAccessibleConversation(userId: string, conversationId: string): Promise<Conversation | null> {
  return prisma.conversation.findFirst({ where: accessibleConversationWhere(userId, conversationId) });
}
