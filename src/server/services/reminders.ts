import { prisma } from "@/lib/db/prisma";
import { getSlackClientForWorkspace } from "@/lib/slack/client";
import { conversationLabel } from "@/lib/slack/conversationLabel";

const EXCERPT_LENGTH = 140;

/**
 * "Remind me about this message" — Slack's reminders.add takes free text plus a time, so the
 * reminder carries a short excerpt, who said it, where, and a permalink back to the message.
 */
export async function remindAboutMessage(
  userId: string,
  messageId: string,
  time: number | string
): Promise<{ ok: true } | { ok: false; error: "not_found" | "missing_scope" | "failed" }> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { author: true, conversation: { include: { members: { include: { slackUser: true } } } } },
  });
  if (!message) return { ok: false, error: "not_found" };

  const { conversation } = message;
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, workspaceId: conversation.workspaceId, revokedAt: null },
  });
  if (!installation) return { ok: false, error: "failed" };

  try {
    const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
    const permalink = await client.chat
      .getPermalink({ channel: conversation.slackConversationId, message_ts: message.slackTs })
      .then((r) => r.permalink)
      .catch(() => undefined);

    const excerpt = message.text.length > EXCERPT_LENGTH ? `${message.text.slice(0, EXCERPT_LENGTH)}…` : message.text;
    const where = conversationLabel(conversation, installation.slackUserId);
    const who = message.author?.displayName ?? "someone";
    const text = `${who} in ${where}: "${excerpt || "(attachment)"}"${permalink ? ` ${permalink}` : ""}`;

    await client.reminders.add({ text, time });
    return { ok: true };
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    return { ok: false, error: code === "missing_scope" ? "missing_scope" : "failed" };
  }
}
