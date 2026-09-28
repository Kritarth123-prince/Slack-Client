import type { Conversation } from "@prisma/client";
import { getSlackClientForWorkspace } from "@/lib/slack/client";

export interface ScheduledMessageView {
  id: string;
  text: string;
  postAt: string; // ISO
}

// Slack accepts post_at up to 120 days out and rejects anything in the past.
const MAX_DAYS_AHEAD = 120;

export function validatePostAt(postAtIso: string): number | null {
  const ms = Date.parse(postAtIso);
  if (Number.isNaN(ms)) return null;
  const secs = Math.floor(ms / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (secs <= now + 30) return null;
  if (secs > now + MAX_DAYS_AHEAD * 24 * 60 * 60) return null;
  return secs;
}

/** Schedules a message via chat.scheduleMessage; Slack posts it as the user at post_at. */
export async function scheduleMessage(
  userId: string,
  conversation: Conversation,
  input: { text: string; postAt: number; threadTs?: string }
): Promise<ScheduledMessageView> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  const res = await client.chat.scheduleMessage({
    channel: conversation.slackConversationId,
    text: input.text,
    post_at: input.postAt,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
  });
  return {
    id: res.scheduled_message_id ?? "",
    text: input.text,
    postAt: new Date(input.postAt * 1000).toISOString(),
  };
}

export async function listScheduledMessages(userId: string, conversation: Conversation): Promise<ScheduledMessageView[]> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  const res = await client.chat.scheduledMessages.list({ channel: conversation.slackConversationId, limit: 50 });
  return (res.scheduled_messages ?? [])
    .filter((m) => m.id && m.post_at)
    .map((m) => ({ id: m.id!, text: m.text ?? "", postAt: new Date(m.post_at! * 1000).toISOString() }))
    .sort((a, b) => a.postAt.localeCompare(b.postAt));
}

export async function cancelScheduledMessage(userId: string, conversation: Conversation, scheduledMessageId: string): Promise<void> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  await client.chat.deleteScheduledMessage({
    channel: conversation.slackConversationId,
    scheduled_message_id: scheduledMessageId,
  });
}
