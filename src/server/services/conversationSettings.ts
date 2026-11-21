import { prisma } from "@/lib/db/prisma";

export interface ConversationSettingView {
  pinned: boolean;
  muted: boolean;
  /** Set after "Clear history": messages at or before this ts are hidden from this user's view. */
  clearedBeforeTs: string | null;
}

export async function getConversationSetting(userId: string, conversationId: string): Promise<ConversationSettingView> {
  const row = await prisma.conversationSetting.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
  return { pinned: row?.pinned ?? false, muted: row?.muted ?? false, clearedBeforeTs: row?.clearedBeforeTs ?? null };
}

export async function updateConversationSetting(
  userId: string,
  conversationId: string,
  input: Partial<ConversationSettingView>
): Promise<ConversationSettingView> {
  const row = await prisma.conversationSetting.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    update: input,
    create: {
      userId,
      conversationId,
      pinned: input.pinned ?? false,
      muted: input.muted ?? false,
      clearedBeforeTs: input.clearedBeforeTs ?? null,
    },
  });
  return { pinned: row.pinned, muted: row.muted, clearedBeforeTs: row.clearedBeforeTs };
}

export async function isConversationMuted(userId: string, conversationId: string): Promise<boolean> {
  const row = await prisma.conversationSetting.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: { muted: true },
  });
  return row?.muted ?? false;
}
