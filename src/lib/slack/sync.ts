import type { WebClient } from "@slack/web-api";
import { ConversationType, type Conversation, type Message, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSlackClientForWorkspace, getSlackClientForInstallation } from "@/lib/slack/client";
import type { SlackEventEnvelope } from "@/lib/slack/events";
import { sendPushToUser, notificationAllowed } from "@/lib/push";
import { logger } from "@/lib/logger";
import { getActiveInstallation, getInstallationForWorkspace } from "@/lib/slack/installation";

type SlackEvent = NonNullable<SlackEventEnvelope["event"]>;

interface SlackChannelLike {
  id?: string;
  name?: string;
  user?: string; // the other party's Slack user id, present on IM channels
  topic?: { value?: string };
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  is_member?: boolean;
}

const MENTION_RE = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;

/** Ensures every user mentioned in a message's text is cached, so their name can be resolved for display. */
async function resolveMentionedUsers(workspaceId: string, client: WebClient, text: string): Promise<void> {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    ids.add(match[1]);
  }
  for (const id of ids) {
    await upsertWorkspaceUser(workspaceId, client, id);
  }
}

function mapConversationType(channel: SlackChannelLike): ConversationType {
  if (channel.is_im) return ConversationType.DM;
  if (channel.is_mpim) return ConversationType.GROUP_DM;
  if (channel.is_private) return ConversationType.PRIVATE_CHANNEL;
  return ConversationType.PUBLIC_CHANNEL;
}

async function upsertConversation(workspaceId: string, channel: SlackChannelLike): Promise<Conversation | null> {
  if (!channel.id) return null;

  return prisma.conversation.upsert({
    where: { workspaceId_slackConversationId: { workspaceId, slackConversationId: channel.id } },
    update: {
      type: mapConversationType(channel),
      name: channel.name ?? null,
      topic: channel.topic?.value ?? null,
      isArchived: channel.is_archived ?? false,
      isMember: channel.is_member ?? true,
    },
    create: {
      workspaceId,
      slackConversationId: channel.id,
      type: mapConversationType(channel),
      name: channel.name ?? null,
      topic: channel.topic?.value ?? null,
      isArchived: channel.is_archived ?? false,
      isMember: channel.is_member ?? true,
    },
  });
}

/** Caches a Slack member's profile the first time we see their id in this workspace. */
async function upsertWorkspaceUser(workspaceId: string, client: WebClient, slackUserId: string) {
  const existing = await prisma.slackUser.findUnique({
    where: { workspaceId_slackUserId: { workspaceId, slackUserId } },
  });
  if (existing) return existing;

  const info = await client.users.info({ user: slackUserId }).catch(() => null);
  const profile = info?.user;

  return prisma.slackUser.upsert({
    where: { workspaceId_slackUserId: { workspaceId, slackUserId } },
    update: {},
    create: {
      workspaceId,
      slackUserId,
      displayName: profile?.profile?.display_name || profile?.real_name || slackUserId,
      realName: profile?.real_name ?? null,
      avatarUrl: profile?.profile?.image_192 ?? null,
      isBot: profile?.is_bot ?? false,
      deleted: profile?.deleted ?? false,
    },
  });
}

function tsToDate(slackTs: string): Date {
  return new Date(Number(slackTs.split(".")[0]) * 1000);
}

/**
 * Caches every workspace member in one paginated sweep. Called once per conversation-list load so
 * that resolving message authors/mentions later is a DB read instead of one Slack API call per
 * distinct person — that per-person lookup was the main cause of very slow first-open chat loads.
 */
async function syncWorkspaceUsers(workspaceId: string, client: WebClient): Promise<void> {
  let cursor: string | undefined;
  do {
    const res = await client.users.list({ limit: 200, cursor }).catch(() => null);
    if (!res) return;

    for (const member of res.members ?? []) {
      if (!member.id) continue;
      const displayName = member.profile?.display_name || member.real_name || member.id;
      await prisma.slackUser.upsert({
        where: { workspaceId_slackUserId: { workspaceId, slackUserId: member.id } },
        update: {
          displayName,
          realName: member.real_name ?? null,
          avatarUrl: member.profile?.image_192 ?? null,
          isBot: member.is_bot ?? false,
          deleted: member.deleted ?? false,
        },
        create: {
          workspaceId,
          slackUserId: member.id,
          displayName,
          realName: member.real_name ?? null,
          avatarUrl: member.profile?.image_192 ?? null,
          isBot: member.is_bot ?? false,
          deleted: member.deleted ?? false,
        },
      });
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

async function fetchConversationMemberIds(client: WebClient, slackConversationId: string): Promise<string[]> {
  const memberIds: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.members({ channel: slackConversationId, limit: 200, cursor });
    memberIds.push(...(res.members ?? []));
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return memberIds;
}

async function upsertConversationMember(conversationId: string, slackUserRowId: string): Promise<void> {
  await prisma.conversationMember.upsert({
    where: { conversationId_slackUserId: { conversationId, slackUserId: slackUserRowId } },
    update: {},
    create: { conversationId, slackUserId: slackUserRowId },
  });
}

/**
 * Records that the user has seen messages up to this point, clearing the unread indicator. Only
 * ever moves the cursor forward (the open conversation calls this on every poll) unless `rewind`
 * is set, which "mark unread from here" uses. When the cursor actually moves it's also pushed to
 * Slack via conversations.mark, so reading here clears the badge in Slack's own apps too — that
 * call is best-effort, since it needs write scopes the app doesn't require (see
 * SLACK_EXTRA_USER_SCOPES).
 */
export async function markConversationRead(
  userId: string,
  conversationId: string,
  lastReadTs: string,
  options: { rewind?: boolean; pushToSlack?: boolean } = {}
): Promise<void> {
  const existing = await prisma.readState.findUnique({ where: { userId_conversationId: { userId, conversationId } } });
  if (existing && !options.rewind && existing.lastReadTs >= lastReadTs) return;

  await prisma.readState.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    update: { lastReadTs },
    create: { userId, conversationId, lastReadTs },
  });

  if (options.pushToSlack === false) return;
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return;
  try {
    const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
    await client.conversations.mark({ channel: conversation.slackConversationId, ts: lastReadTs });
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    if (code !== "missing_scope" && code !== "not_allowed_token_type") {
      logger.warn("Failed to push read cursor to Slack", { code, message: (err as Error).message });
    }
  }
}

const MAX_READ_CURSOR_CHECKS = 20;

/**
 * Pulls Slack's own read cursor for conversations this app still thinks are unread, so reading a
 * message in Slack's official app clears it here too. Slack has no read-cursor event on the Events
 * API, so this is polled — but only for locally-unread conversations (a handful of concurrent
 * conversations.info calls per list refresh, not one per conversation). Runs *before* the heavier
 * per-conversation message sync so it still completes on platforms with short request timeouts.
 */
export async function syncReadCursorsFromSlack(userId: string, installation: { workspaceId: string }): Promise<void> {
  const [conversations, readStates] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false, lastMessageTs: { not: null } },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      select: { id: true, slackConversationId: true, lastMessageTs: true },
    }),
    prisma.readState.findMany({ where: { userId }, select: { conversationId: true, lastReadTs: true } }),
  ]);
  const readMap = new Map(readStates.map((r) => [r.conversationId, r.lastReadTs]));
  const unread = conversations
    .filter((c) => {
      const lastRead = readMap.get(c.id);
      return !lastRead || lastRead < c.lastMessageTs!;
    })
    .slice(0, MAX_READ_CURSOR_CHECKS);
  if (unread.length === 0) return;

  const client = await getSlackClientForWorkspace(userId, installation.workspaceId);
  let updated = 0;
  await Promise.all(
    unread.map(async (conversation) => {
      const info = await client.conversations.info({ channel: conversation.slackConversationId }).catch(() => null);
      const channel = info?.channel as
        | { last_read?: string; unread_count?: number; unread_count_display?: number; latest?: { ts?: string } }
        | undefined;
      if (!channel) return;

      // Prefer Slack's cursor; if Slack reports nothing unread but gives no cursor, treat the
      // newest root we know of as read.
      let slackLastRead = channel.last_read;
      const slackUnread = channel.unread_count_display ?? channel.unread_count;
      if ((!slackLastRead || slackLastRead === "0000000000.000000") && slackUnread === 0) {
        slackLastRead = channel.latest?.ts ?? conversation.lastMessageTs ?? undefined;
      }
      if (!slackLastRead) return;

      const local = readMap.get(conversation.id);
      if (!local || slackLastRead > local) {
        await markConversationRead(userId, conversation.id, slackLastRead, { pushToSlack: false });
        updated++;
      }
    })
  );
  logger.info("Synced read cursors from Slack", { checked: unread.length, updated });
}

/** Returns this conversation's members, resolved to display names (used by the @-mention picker). */
export async function listConversationMembers(
  userId: string,
  conversation: Conversation
): Promise<{ id: string; displayName: string }[]> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  const memberIds = await fetchConversationMemberIds(client, conversation.slackConversationId);
  const users = await Promise.all(memberIds.map((id) => upsertWorkspaceUser(conversation.workspaceId, client, id)));
  return users.map((u) => ({ id: u.slackUserId, displayName: u.displayName }));
}

/** Fetches the conversations the authorizing user is a member of and upserts them. */
export async function syncConversationsForUser(userId: string): Promise<void> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return;

  const client = await getSlackClientForWorkspace(userId, installation.workspaceId);
  await syncWorkspaceUsers(installation.workspaceId, client).catch((err) =>
    logger.error("Failed to bulk-sync workspace users", { message: (err as Error).message })
  );

  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: true,
      limit: 200,
      cursor,
    });

    for (const channel of res.channels ?? []) {
      if ((channel.is_channel || channel.is_group) && channel.is_member === false) continue;

      const conversation = await upsertConversation(installation.workspaceId, channel);
      if (!conversation) continue;

      // conversations.list doesn't report last-activity time, so the first time we see a
      // conversation, pull its latest message once to seed real ordering (later kept fresh by
      // the events webhook). Skipped on repeat syncs so this doesn't cost an API call every time.
      if (!conversation.lastMessageTs) {
        const latest = await client.conversations
          .history({ channel: conversation.slackConversationId, limit: 1 })
          .catch(() => null);
        const latestTs = latest?.messages?.[0]?.ts;
        if (latestTs) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: tsToDate(latestTs), lastMessageTs: latestTs },
          });
        }
      }

      // DMs/group DMs have no channel name, so we need their members to build a display label.
      if (channel.is_im && channel.user) {
        const other = await upsertWorkspaceUser(installation.workspaceId, client, channel.user);
        await upsertConversationMember(conversation.id, other.id);
      } else if (channel.is_mpim) {
        const memberIds = await fetchConversationMemberIds(client, conversation.slackConversationId);
        for (const slackUserId of memberIds) {
          if (slackUserId === installation.slackUserId) continue;
          const member = await upsertWorkspaceUser(installation.workspaceId, client, slackUserId);
          await upsertConversationMember(conversation.id, member.id);
        }
      }
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

/** The newest cached root (non-reply) message in a conversation, if any. */
async function latestRootMessage(conversationId: string): Promise<{ slackTs: string } | null> {
  const recent = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { slackTs: "desc" },
    take: 25,
    select: { slackTs: true, threadTs: true },
  });
  return recent.find((m) => !m.threadTs || m.threadTs === m.slackTs) ?? null;
}

/**
 * Fetches history for a conversation and upserts it into the DB. When messages are already
 * cached, only fetches what's newer than the latest cached message (via `oldest`) instead of
 * re-pulling the last `limit` every time — this is what keeps new messages appearing even when
 * the Events API webhook isn't reaching this deployment (e.g. a stale/misconfigured Request URL,
 * or the platform blocking the callback before it reaches our handler).
 */
export async function syncMessages(userId: string, conversation: Conversation, limit = 50): Promise<Message[]> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);

  // Only root messages count as "the latest" here: conversations.history never returns thread
  // replies, and a reply cached via the webhook can be newer than any root. Using a reply's ts as
  // `oldest` would skip roots posted before it, and treating it as the conversation's last
  // message keeps the conversation "unread" after Slack's own read cursor (which only tracks
  // roots) has moved past everything.
  const latestCached = await latestRootMessage(conversation.id);

  const res = await client.conversations.history({
    channel: conversation.slackConversationId,
    limit,
    ...(latestCached ? { oldest: latestCached.slackTs } : {}),
  });

  // Only meaningful when `latestCached` was set: every message returned here is strictly newer
  // than what we already had, so (unlike the very first backfill, where everything is "new" but
  // none of it should trigger a notification) these are genuine new arrivals.
  const newlyArrived: Message[] = [];

  for (const msg of res.messages ?? []) {
    if (!msg.ts) continue;

    let authorId: string | null = null;
    if (msg.user) {
      const author = await upsertWorkspaceUser(conversation.workspaceId, client, msg.user);
      authorId = author.id;
    }
    if (msg.text) await resolveMentionedUsers(conversation.workspaceId, client, msg.text);

    const row = await prisma.message.upsert({
      where: { conversationId_slackTs: { conversationId: conversation.id, slackTs: msg.ts } },
      update: {
        text: msg.text ?? "",
        raw: msg as Prisma.InputJsonValue,
      },
      create: {
        conversationId: conversation.id,
        slackTs: msg.ts,
        threadTs: msg.thread_ts ?? msg.ts,
        authorId,
        text: msg.text ?? "",
        raw: msg as Prisma.InputJsonValue,
      },
    });

    if (latestCached) newlyArrived.push(row);
  }

  // Keep lastMessageTs pointing at the newest *root* message (see latestRootMessage) — this also
  // repairs rows that were previously advanced by a thread reply.
  const latestRoot = res.messages?.[0]?.ts ?? latestCached?.slackTs;
  if (latestRoot && latestRoot !== conversation.lastMessageTs) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: tsToDate(latestRoot), lastMessageTs: latestRoot },
    });
  }

  await backfillStaleThreads(conversation, client).catch((err) =>
    logger.error("Failed to backfill thread replies", { message: (err as Error).message })
  );

  return newlyArrived;
}

interface StaleThreadRoot {
  slackTs: string;
  replyCount: number;
}

/**
 * conversations.history (used above) only ever returns root/top-level messages — Slack never
 * includes thread replies in it, and once a root message is cached, the `oldest` cursor means
 * history stops returning it on later calls too. So a thread that already had replies before this
 * app ever synced the conversation (or whose replies came from clients this app's webhook doesn't
 * reach) would otherwise never get its replies fetched. This finds exactly the thread roots where
 * Slack's own reply_count (cached on the root message the last time it was fetched) is ahead of
 * how many reply rows we actually have, so the fetch below only runs for threads that are behind.
 */
async function findStaleThreadRoots(conversationId: string): Promise<StaleThreadRoot[]> {
  return prisma.$queryRaw<StaleThreadRoot[]>`
    SELECT m."slackTs" AS "slackTs", (m.raw->>'reply_count')::int AS "replyCount"
    FROM "Message" m
    WHERE m."conversationId" = ${conversationId}
      AND m."threadTs" = m."slackTs"
      AND m.raw->>'reply_count' IS NOT NULL
      AND (m.raw->>'reply_count')::int > (
        SELECT COUNT(*)::int FROM "Message" r
        WHERE r."conversationId" = m."conversationId"
          AND r."threadTs" = m."slackTs"
          AND r."slackTs" != m."slackTs"
      )
  `;
}

async function backfillStaleThreads(conversation: Conversation, client: WebClient): Promise<void> {
  const stale = await findStaleThreadRoots(conversation.id);
  for (const root of stale) {
    await syncThreadReplies(conversation, client, root.slackTs);
  }
}

/** Fetches every reply in a thread via conversations.replies and upserts them (the root itself is skipped — it's already synced as a normal history message). */
async function syncThreadReplies(conversation: Conversation, client: WebClient, threadTs: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const res = await client.conversations
      .replies({ channel: conversation.slackConversationId, ts: threadTs, limit: 200, cursor })
      .catch(() => null);
    if (!res) return;

    for (const reply of res.messages ?? []) {
      if (!reply.ts || reply.ts === threadTs) continue;

      let authorId: string | null = null;
      if (reply.user) {
        const author = await upsertWorkspaceUser(conversation.workspaceId, client, reply.user);
        authorId = author.id;
      }
      if (reply.text) await resolveMentionedUsers(conversation.workspaceId, client, reply.text);

      await prisma.message.upsert({
        where: { conversationId_slackTs: { conversationId: conversation.id, slackTs: reply.ts } },
        update: { text: reply.text ?? "", raw: reply as Prisma.InputJsonValue },
        create: {
          conversationId: conversation.id,
          slackTs: reply.ts,
          threadTs: reply.thread_ts ?? threadTs,
          authorId,
          text: reply.text ?? "",
          raw: reply as Prisma.InputJsonValue,
        },
      });
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

// A real workspace typically has far more channels than DMs, and each conversation costs a
// sequential Slack API call here — without a bound, a large channel list can make this take long
// enough to hit the platform's request timeout, silently dropping the unread/notify update for
// every conversation that never gets its turn (channels most often, since a typical workspace has
// many more of them than DMs). SYNC_BUDGET_MS keeps this call fast and predictable regardless of
// workspace size; MAX_CONVERSATIONS_PER_SYNC is a hard backstop under pathological conversation counts.
const SYNC_BUDGET_MS = 8000;
const MAX_CONVERSATIONS_PER_SYNC = 60;

/**
 * Catches up every conversation for a user and pushes a notification for each genuinely new
 * message from someone else. This is the polling-based stand-in for the Events API webhook path
 * (which also notifies, in `handleMessageEvent`) — it's what lets unread highlighting and
 * notifications work even when the webhook isn't reaching this deployment.
 */
export async function syncAllConversationsAndNotify(userId: string): Promise<void> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return;

  const [conversations, self] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false },
      // Most-recently-active first, so a large channel list degrades gracefully: whatever gets
      // cut off by the time/count budget below is whatever mattered least right now.
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: MAX_CONVERSATIONS_PER_SYNC,
    }),
    prisma.slackUser.findUnique({
      where: {
        workspaceId_slackUserId: { workspaceId: installation.workspaceId, slackUserId: installation.slackUserId },
      },
    }),
  ]);

  await syncReadCursorsFromSlack(userId, installation).catch((err) =>
    logger.warn("Failed to sync read cursors from Slack", { message: (err as Error).message })
  );

  const startedAt = Date.now();

  for (const conversation of conversations) {
    if (Date.now() - startedAt > SYNC_BUDGET_MS) {
      logger.warn("Stopped conversation sync early to stay within the time budget", {
        remaining: conversations.length,
      });
      break;
    }

    let newMessages: Message[];
    try {
      newMessages = await syncMessages(userId, conversation, 20);
    } catch (err) {
      logger.error("Failed to sync conversation during list refresh", { message: (err as Error).message });
      continue;
    }

    for (const msg of newMessages) {
      if (!msg.authorId || msg.authorId === self?.id) continue;

      const allowed = await notificationAllowed(userId, {
        conversationId: conversation.id,
        conversationType: conversation.type,
        text: msg.text,
        selfSlackUserId: installation.slackUserId,
        isThreadReply: Boolean(msg.threadTs && msg.threadTs !== msg.slackTs),
      });
      if (!allowed) continue;

      const author = await prisma.slackUser.findUnique({ where: { id: msg.authorId } });
      await sendPushToUser(userId, {
        title: author?.displayName ?? "New message",
        body: msg.text || "Sent an attachment",
        url: `/app/${conversation.id}`,
      }).catch((err) => logger.error("Failed to send push notification", { message: (err as Error).message }));
    }
  }
}

/** Sends a message as the authorizing user, then upserts it locally so the UI reflects it instantly. */
export async function postMessage(
  userId: string,
  conversation: Conversation,
  text: string,
  threadTs?: string
): Promise<void> {
  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  const res = await client.chat.postMessage({
    channel: conversation.slackConversationId,
    text,
    thread_ts: threadTs,
  });
  if (!res.ts) throw new Error("Slack did not return a timestamp for the sent message");

  const author = await upsertWorkspaceUser(conversation.workspaceId, client, installation.slackUserId);
  await resolveMentionedUsers(conversation.workspaceId, client, text);

  await prisma.message.upsert({
    where: { conversationId_slackTs: { conversationId: conversation.id, slackTs: res.ts } },
    update: {},
    create: {
      conversationId: conversation.id,
      slackTs: res.ts,
      threadTs: threadTs ?? res.ts,
      authorId: author.id,
      text,
      raw: (res.message ?? {}) as Prisma.InputJsonValue,
    },
  });

  // Thread replies don't move the conversation's "latest message" — Slack's own read cursor only
  // tracks root messages, and treating a reply as the latest would leave the conversation unread.
  if (!threadTs) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: tsToDate(res.ts), lastMessageTs: res.ts },
    });
  }
}

/** Edits a message the authorizing user sent, then reflects the new text locally. */
export async function editMessage(
  userId: string,
  conversation: Conversation,
  message: Message,
  text: string
): Promise<void> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  await client.chat.update({ channel: conversation.slackConversationId, ts: message.slackTs, text });
  await resolveMentionedUsers(conversation.workspaceId, client, text);

  await prisma.message.update({
    where: { id: message.id },
    data: { text, isEdited: true },
  });
}

/** Deletes a message the authorizing user sent (soft-deletes locally, mirroring the webhook path). */
export async function deleteMessage(userId: string, conversation: Conversation, message: Message): Promise<void> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  await client.chat.delete({ channel: conversation.slackConversationId, ts: message.slackTs });

  await prisma.message.update({
    where: { id: message.id },
    data: { deletedAt: new Date() },
  });
}

/**
 * Pins/unpins a message. The Slack call is best-effort: `pins:write` may not be granted on
 * installations from before this feature shipped, so a missing-scope failure still lets the
 * local pin state (this app's own "pinned" list) apply instead of blocking the action outright.
 */
export async function setMessagePinned(
  userId: string,
  conversation: Conversation,
  message: Message,
  pinned: boolean
): Promise<void> {
  try {
    const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
    if (pinned) {
      await client.pins.add({ channel: conversation.slackConversationId, timestamp: message.slackTs });
    } else {
      await client.pins.remove({ channel: conversation.slackConversationId, timestamp: message.slackTs });
    }
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    if (code !== "missing_scope" && code !== "already_pinned" && code !== "not_pinned") {
      logger.error("Failed to sync pin state to Slack", { message: (err as Error).message });
    }
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { pinned, pinnedAt: pinned ? new Date() : null },
  });
}

/** Forwards a message's text (and files, via the raw payload) into another conversation as a new message. */
export async function forwardMessage(
  userId: string,
  targetConversation: Conversation,
  originalMessage: Message
): Promise<void> {
  const installation = await getInstallationForWorkspace(userId, targetConversation.workspaceId);
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForWorkspace(userId, targetConversation.workspaceId);
  const res = await client.chat.postMessage({
    channel: targetConversation.slackConversationId,
    text: originalMessage.text,
  });
  if (!res.ts) throw new Error("Slack did not return a timestamp for the forwarded message");

  const author = await upsertWorkspaceUser(targetConversation.workspaceId, client, installation.slackUserId);

  await prisma.message.upsert({
    where: { conversationId_slackTs: { conversationId: targetConversation.id, slackTs: res.ts } },
    update: {},
    create: {
      conversationId: targetConversation.id,
      slackTs: res.ts,
      threadTs: res.ts,
      authorId: author.id,
      text: originalMessage.text,
      forwardedFromId: originalMessage.id,
      raw: (res.message ?? {}) as Prisma.InputJsonValue,
    },
  });

  await prisma.conversation.update({
    where: { id: targetConversation.id },
    data: { lastMessageAt: tsToDate(res.ts), lastMessageTs: res.ts },
  });
}

/**
 * Uploads a file (or a recorded voice note) to Slack as the authorizing user, then resyncs the
 * conversation so the resulting message (with its file payload) lands in the local cache the same
 * way any other new message does — simpler and more robust than hand-parsing uploadV2's response.
 */
export async function uploadFiles(
  userId: string,
  conversation: Conversation,
  upload: { files: { data: Buffer; filename: string }[]; threadTs?: string; initialComment?: string }
): Promise<void> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  // Several files go up as one `file_uploads` batch so Slack posts them as a single message
  // (with the caption on it) rather than one message per file.
  const shared = {
    file_uploads: upload.files.map((f) => ({ file: f.data, filename: f.filename })),
    initial_comment: upload.initialComment,
  };
  // files.uploadV2's types model "posting into a thread" and "posting into a channel" as a
  // discriminated union (thread_ts is required alongside channel_id, or disallowed entirely) — so
  // this needs two call sites rather than one object with an optional thread_ts.
  if (upload.threadTs) {
    await client.files.uploadV2({ channel_id: conversation.slackConversationId, thread_ts: upload.threadTs, ...shared });
  } else {
    await client.files.uploadV2({ channel_id: conversation.slackConversationId, ...shared });
  }

  await syncMessages(userId, conversation);
}

/** Adds an emoji reaction as the authorizing user, then reflects it locally without waiting on the webhook. */
export async function addReaction(
  userId: string,
  conversation: Conversation,
  message: Message,
  emoji: string
): Promise<void> {
  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  await client.reactions.add({ channel: conversation.slackConversationId, timestamp: message.slackTs, name: emoji });

  const self = await upsertWorkspaceUser(conversation.workspaceId, client, installation.slackUserId);
  await prisma.reaction.upsert({
    where: { messageId_emoji_slackUserId: { messageId: message.id, emoji, slackUserId: self.id } },
    update: {},
    create: { messageId: message.id, emoji, slackUserId: self.id },
  });
}

export async function removeReaction(
  userId: string,
  conversation: Conversation,
  message: Message,
  emoji: string
): Promise<void> {
  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  await client.reactions
    .remove({ channel: conversation.slackConversationId, timestamp: message.slackTs, name: emoji })
    .catch(() => {});

  const self = await upsertWorkspaceUser(conversation.workspaceId, client, installation.slackUserId);
  await prisma.reaction.deleteMany({ where: { messageId: message.id, emoji, slackUserId: self.id } });
}

/** Applies an incoming Events API callback to the DB. */
export async function processSlackEvent(envelope: SlackEventEnvelope): Promise<void> {
  const event = envelope.event;
  const teamId = envelope.team_id;
  if (!event || !teamId) return;

  const workspace = await prisma.workspace.findUnique({ where: { slackTeamId: teamId } });
  if (!workspace) return;

  const installation = await prisma.slackInstallation.findFirst({
    where: { workspaceId: workspace.id, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return;

  const client = await getSlackClientForInstallation(installation);

  if (event.type === "message") {
    await handleMessageEvent(workspace.id, client, event, {
      userId: installation.userId,
      selfSlackUserId: installation.slackUserId,
    });
  } else if (event.type === "reaction_added" || event.type === "reaction_removed") {
    await handleReactionEvent(workspace.id, client, event, event.type === "reaction_added");
  }
}

async function handleMessageEvent(
  workspaceId: string,
  client: WebClient,
  event: SlackEvent,
  notify: { userId: string; selfSlackUserId: string }
): Promise<void> {
  if (!event.channel) return;

  let conversation = await prisma.conversation.findUnique({
    where: { workspaceId_slackConversationId: { workspaceId, slackConversationId: event.channel } },
  });

  if (!conversation) {
    const info = await client.conversations.info({ channel: event.channel }).catch(() => null);
    if (!info?.channel) return;
    conversation = await upsertConversation(workspaceId, info.channel);
    if (!conversation) return;
  }

  if (event.subtype === "message_deleted") {
    const deletedTs = event.deleted_ts as string | undefined;
    if (deletedTs) {
      await prisma.message.updateMany({
        where: { conversationId: conversation.id, slackTs: deletedTs },
        data: { deletedAt: new Date() },
      });
    }
    return;
  }

  const nested = event.subtype === "message_changed" ? event.message : undefined;
  const ts = nested?.ts ?? event.ts;
  if (!ts) return;

  const authorSlackId = nested?.user ?? event.user;
  let authorId: string | null = null;
  let authorName: string | undefined;
  if (authorSlackId) {
    const author = await upsertWorkspaceUser(workspaceId, client, authorSlackId);
    authorId = author.id;
    authorName = author.displayName;
  }

  const text = nested?.text ?? event.text ?? "";
  const threadTs = nested?.thread_ts ?? event.thread_ts ?? ts;
  if (text) await resolveMentionedUsers(workspaceId, client, text);

  const isNewMessage = event.subtype !== "message_changed";

  await prisma.message.upsert({
    where: { conversationId_slackTs: { conversationId: conversation.id, slackTs: ts } },
    update: {
      text,
      isEdited: event.subtype === "message_changed",
      raw: event as Prisma.InputJsonValue,
    },
    create: {
      conversationId: conversation.id,
      slackTs: ts,
      threadTs,
      authorId,
      text,
      raw: event as Prisma.InputJsonValue,
    },
  });

  if (threadTs === ts) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: tsToDate(ts), lastMessageTs: ts },
    });
  }

  if (isNewMessage && authorSlackId && authorSlackId !== notify.selfSlackUserId) {
    const allowed = await notificationAllowed(notify.userId, {
      conversationId: conversation.id,
      conversationType: conversation.type,
      text,
      selfSlackUserId: notify.selfSlackUserId,
      isThreadReply: threadTs !== ts,
    });
    if (!allowed) return;

    await sendPushToUser(notify.userId, {
      title: authorName ?? "New message",
      body: text || "Sent an attachment",
      url: `/app/${conversation.id}`,
    }).catch((err) => logger.error("Failed to send push notification", { message: (err as Error).message }));
  }
}

async function handleReactionEvent(
  workspaceId: string,
  client: WebClient,
  event: SlackEvent,
  added: boolean
): Promise<void> {
  const channel = event.item?.channel;
  const ts = event.item?.ts;
  const emoji = event.reaction;
  const slackUserId = event.user;
  if (!channel || !ts || !emoji || !slackUserId) return;

  const conversation = await prisma.conversation.findUnique({
    where: { workspaceId_slackConversationId: { workspaceId, slackConversationId: channel } },
  });
  if (!conversation) return;

  const message = await prisma.message.findUnique({
    where: { conversationId_slackTs: { conversationId: conversation.id, slackTs: ts } },
  });
  if (!message) return;

  const slackUser = await upsertWorkspaceUser(workspaceId, client, slackUserId);

  if (added) {
    await prisma.reaction.upsert({
      where: { messageId_emoji_slackUserId: { messageId: message.id, emoji, slackUserId: slackUser.id } },
      update: {},
      create: { messageId: message.id, emoji, slackUserId: slackUser.id },
    });
  } else {
    await prisma.reaction.deleteMany({
      where: { messageId: message.id, emoji, slackUserId: slackUser.id },
    });
  }
}
