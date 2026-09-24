import type { ConversationType } from "@prisma/client";

interface ConversationLike {
  name: string | null;
  type: ConversationType;
  members: { slackUser: { slackUserId: string; displayName: string } }[];
}

/** Public/private channels use their Slack name; DMs and group DMs are named after the other members. */
export function conversationLabel(conversation: ConversationLike, selfSlackUserId: string): string {
  if (conversation.name) {
    return conversation.type === "PUBLIC_CHANNEL" || conversation.type === "PRIVATE_CHANNEL"
      ? `#${conversation.name}`
      : conversation.name;
  }

  const others = conversation.members
    .map((m) => m.slackUser)
    .filter((u) => u.slackUserId !== selfSlackUserId);

  if (others.length > 0) return others.map((u) => u.displayName).join(", ");

  return conversation.type === "DM" ? "Direct message" : "Group message";
}
