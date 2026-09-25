import type { ConversationType } from "@prisma/client";

interface ConversationLike {
  name: string | null;
  type: ConversationType;
  members: { slackUser: { slackUserId: string; displayName: string; avatarUrl: string | null } }[];
}

function otherMembers(conversation: ConversationLike, selfSlackUserId: string) {
  return conversation.members.map((m) => m.slackUser).filter((u) => u.slackUserId !== selfSlackUserId);
}

/** Public/private channels use their Slack name; DMs and group DMs are named after the other members. */
export function conversationLabel(conversation: ConversationLike, selfSlackUserId: string): string {
  if (conversation.name) {
    return conversation.type === "PUBLIC_CHANNEL" || conversation.type === "PRIVATE_CHANNEL"
      ? `#${conversation.name}`
      : conversation.name;
  }

  const others = otherMembers(conversation, selfSlackUserId);
  if (others.length > 0) return others.map((u) => u.displayName).join(", ");

  return conversation.type === "DM" ? "Direct message" : "Group message";
}

/** A 1:1 DM shows the other person's Slack profile photo; channels and group DMs fall back to an icon/initials. */
export function conversationAvatarUrl(conversation: ConversationLike, selfSlackUserId: string): string | null {
  if (conversation.type !== "DM") return null;
  const [other] = otherMembers(conversation, selfSlackUserId);
  return other?.avatarUrl ?? null;
}
