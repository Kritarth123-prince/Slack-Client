import type { Conversation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSlackClientForInstallation } from "@/lib/slack/client";
import { getInstallationForWorkspace } from "@/lib/slack/installation";
import { markConversationRead } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";
import type { SlackMessagePayload } from "@/lib/slack/syncHelpers";
import { updateConversationSetting, type ConversationSettingView } from "@/server/services/conversationSettings";

// Two ways to empty a conversation, deliberately kept separate because they differ in who they affect:
// - "Clear history" hides everything so far from *your* view in this app. Nothing changes in Slack,
//   it's per user, and it can be undone.
// - "Delete my messages" removes the messages *you* sent from Slack itself, for everyone. Slack
//   doesn't let a user token delete anyone else's messages in a DM, so that's all it can do.

/**
 * Hides every message currently in the conversation from this user's view, and marks it read. The
 * cut-off is the newest message cached (not the server's clock), so a message Slack stamps just
 * before our "now" but delivers just after can't be swallowed by clock skew.
 */
export async function clearConversationHistory(userId: string, conversation: Conversation): Promise<ConversationSettingView> {
  const newest = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { slackTs: "desc" },
    select: { slackTs: true },
  });
  const candidates = [newest?.slackTs, conversation.lastMessageTs].filter((ts): ts is string => Boolean(ts));
  const clearedBeforeTs = candidates.sort().pop() ?? (Date.now() / 1000).toFixed(6);

  const setting = await updateConversationSetting(userId, conversation.id, { clearedBeforeTs });
  await markConversationRead(userId, conversation.id, clearedBeforeTs).catch(() => {});
  return setting;
}

/** Undoes "Clear history" — the messages were only hidden, never deleted. */
export async function restoreConversationHistory(userId: string, conversationId: string): Promise<ConversationSettingView> {
  return updateConversationSetting(userId, conversationId, { clearedBeforeTs: null });
}

export interface DeleteOwnMessagesResult {
  deleted: number;
  failed: number;
  /** True once the whole history has been walked. */
  done: boolean;
  /** Where to resume: pass back as `before` on the next call. */
  before: string | null;
  /** Slack rate-limited the deletes; wait this long before the next batch. */
  retryAfterSeconds: number | null;
}

const DELETE_BATCH_LIMIT = 40;
const DELETE_BATCH_BUDGET_MS = 25_000;
const HISTORY_PAGE_SIZE = 100;

/**
 * Deletes, from Slack, the messages this user sent in a DM or group DM — one bounded batch per
 * call, so a long history never runs into a request timeout; the UI calls again with `before`
 * until `done`. Walks history newest-first using `latest` as the resume point rather than Slack's
 * pagination cursor, because deleting messages shifts what a cursor points at, whereas re-reading
 * from a timestamp is idempotent. Replies the user posted inside threads are included.
 */
export async function deleteOwnMessagesBatch(
  userId: string,
  conversation: Conversation,
  before: string | null
): Promise<DeleteOwnMessagesResult> {
  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  if (!installation) throw new Error("No active Slack installation for this workspace");
  const client = getSlackClientForInstallation(installation, { background: true });
  const selfId = installation.slackUserId;

  const startedAt = Date.now();
  const deletedTs: string[] = [];
  let failed = 0;
  let boundary = before;
  let retryAfterSeconds: number | null = null;

  const outOfBudget = () => deletedTs.length >= DELETE_BATCH_LIMIT || Date.now() - startedAt > DELETE_BATCH_BUDGET_MS;

  /** Deletes one message; returns false if Slack rate-limited us and the batch should stop. */
  async function remove(ts: string): Promise<boolean> {
    try {
      await client.chat.delete({ channel: conversation.slackConversationId, ts });
      deletedTs.push(ts);
    } catch (err) {
      const e = err as { code?: string; retryAfter?: number; data?: { error?: string } };
      if (e.code === "slack_webapi_rate_limited_error") {
        retryAfterSeconds = e.retryAfter ?? 30;
        return false;
      }
      if (e.data?.error === "message_not_found") deletedTs.push(ts);
      else failed++;
    }
    return true;
  }

  let done = false;
  walk: while (!outOfBudget()) {
    let page;
    try {
      page = await client.conversations.history({
        channel: conversation.slackConversationId,
        limit: HISTORY_PAGE_SIZE,
        ...(boundary ? { latest: boundary } : {}),
      });
    } catch (err) {
      const e = err as { code?: string; retryAfter?: number };
      if (e.code !== "slack_webapi_rate_limited_error") throw err;
      retryAfterSeconds = e.retryAfter ?? 30;
      break;
    }
    const messages = (page.messages ?? []) as SlackMessagePayload[];
    if (messages.length === 0) {
      done = true;
      break;
    }

    for (const m of messages) {
      if (!m.ts) continue;
      if (outOfBudget()) break walk;

      // Own replies inside this thread first, so the root (if it's ours) goes last. Any stop in
      // here leaves `boundary` before this root, so the next batch re-reads the thread — replies
      // already deleted are simply gone by then, so that's safe to repeat.
      if ((m.reply_count ?? 0) > 0) {
        let replyCursor: string | undefined;
        do {
          let replies;
          try {
            replies = await client.conversations.replies({
              channel: conversation.slackConversationId,
              ts: m.ts,
              limit: 200,
              cursor: replyCursor,
            });
          } catch (err) {
            const e = err as { code?: string; retryAfter?: number };
            if (e.code !== "slack_webapi_rate_limited_error") throw err;
            retryAfterSeconds = e.retryAfter ?? 30;
            break walk;
          }
          for (const reply of (replies.messages ?? []) as SlackMessagePayload[]) {
            if (!reply.ts || reply.ts === m.ts || reply.user !== selfId || reply.subtype === "tombstone") continue;
            if (outOfBudget() || !(await remove(reply.ts))) break walk;
          }
          replyCursor = replies.response_metadata?.next_cursor || undefined;
        } while (replyCursor);
      }
      if (m.user === selfId && m.subtype !== "tombstone") {
        if (outOfBudget() || !(await remove(m.ts))) break walk;
      }
      boundary = m.ts;
    }

    if (!page.has_more) {
      done = true;
      break;
    }
  }

  if (deletedTs.length > 0) {
    await prisma.message.updateMany({
      where: { conversationId: conversation.id, slackTs: { in: deletedTs } },
      data: { deletedAt: new Date() },
    });
    logger.info("Deleted own messages from a conversation", { deleted: deletedTs.length, failed });
  }

  return { deleted: deletedTs.length, failed, done, before: boundary, retryAfterSeconds };
}
