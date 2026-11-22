import type { WebClient } from "@slack/web-api";
import { ConversationType, type Conversation, type Message, type Prisma, type SlackUser } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSlackClientForWorkspace, getSlackClientForInstallation } from "@/lib/slack/client";
import type { SlackEventEnvelope } from "@/lib/slack/events";
import { sendPushToUser, notificationAllowed } from "@/lib/push";
import { logger } from "@/lib/logger";
import { getActiveInstallation, getInstallationForWorkspace } from "@/lib/slack/installation";
import { canMarkReadInSlack } from "@/lib/slack/scopes";
import {
  diffReactions,
  mapWithConcurrency,
  mentionedUserIds,
  messageFingerprint,
  slackTextToPlain,
  tsToDate,
  type ReactionKey,
  type SlackMessagePayload,
} from "@/lib/slack/syncHelpers";

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

function mapConversationType(channel: SlackChannelLike): ConversationType {
  if (channel.is_im) return ConversationType.DM;
  if (channel.is_mpim) return ConversationType.GROUP_DM;
  if (channel.is_private) return ConversationType.PRIVATE_CHANNEL;
  return ConversationType.PUBLIC_CHANNEL;
}

function conversationFields(channel: SlackChannelLike) {
  return {
    type: mapConversationType(channel),
    name: channel.name ?? null,
    topic: channel.topic?.value ?? null,
    isArchived: channel.is_archived ?? false,
    isMember: channel.is_member ?? true,
  };
}

async function upsertConversation(workspaceId: string, channel: SlackChannelLike): Promise<Conversation | null> {
  if (!channel.id) return null;

  const fields = conversationFields(channel);
  return prisma.conversation.upsert({
    where: { workspaceId_slackConversationId: { workspaceId, slackConversationId: channel.id } },
    update: fields,
    create: { workspaceId, slackConversationId: channel.id, ...fields },
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

/**
 * Makes sure every given Slack user id has a cached profile, returning them keyed by Slack id. One
 * query covers everyone already known (nearly everyone, after the directory sweep); only ids never
 * seen before cost a users.info call. Resolving people one query at a time was the main reason a
 * sync against a remote database took seconds per conversation.
 */
async function ensureWorkspaceUsers(
  workspaceId: string,
  client: WebClient,
  slackUserIds: Iterable<string>
): Promise<Map<string, SlackUser>> {
  const ids = [...new Set(slackUserIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const rows = await prisma.slackUser.findMany({ where: { workspaceId, slackUserId: { in: ids } } });
  const byId = new Map(rows.map((u) => [u.slackUserId, u]));
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, await upsertWorkspaceUser(workspaceId, client, id));
  }
  return byId;
}

/** Ensures every user mentioned in a message's text is cached, so their name can be resolved for display. */
async function resolveMentionedUsers(workspaceId: string, client: WebClient, text: string): Promise<void> {
  await ensureWorkspaceUsers(workspaceId, client, mentionedUserIds(text));
}

/**
 * Caches every workspace member in one paginated sweep, so resolving message authors/mentions later
 * is a DB read instead of one Slack API call per distinct person. Only new or changed profiles are
 * written — re-upserting the whole directory on every list load was hundreds of sequential writes.
 */
async function syncWorkspaceUsers(workspaceId: string, client: WebClient): Promise<void> {
  const known = new Map(
    (await prisma.slackUser.findMany({ where: { workspaceId } })).map((u) => [u.slackUserId, u])
  );

  let cursor: string | undefined;
  do {
    const res = await client.users.list({ limit: 200, cursor }).catch(() => null);
    if (!res) return;

    const toCreate: Prisma.SlackUserCreateManyInput[] = [];
    for (const member of res.members ?? []) {
      if (!member.id) continue;
      const fields = {
        displayName: member.profile?.display_name || member.real_name || member.id,
        realName: member.real_name ?? null,
        avatarUrl: member.profile?.image_192 ?? null,
        isBot: member.is_bot ?? false,
        deleted: member.deleted ?? false,
      };
      const row = known.get(member.id);
      if (!row) {
        toCreate.push({ workspaceId, slackUserId: member.id, ...fields });
      } else if (
        row.displayName !== fields.displayName ||
        row.realName !== fields.realName ||
        row.avatarUrl !== fields.avatarUrl ||
        row.isBot !== fields.isBot ||
        row.deleted !== fields.deleted
      ) {
        await prisma.slackUser.update({ where: { id: row.id }, data: fields });
      }
    }
    if (toCreate.length > 0) await prisma.slackUser.createMany({ data: toCreate, skipDuplicates: true });

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
 * Writes a batch of Slack messages into the cache and returns the rows that were newly inserted —
 * the genuine new arrivals, race-free (a concurrent sync that inserted the same message first gets
 * it instead). Existing rows are rewritten only when Slack reports something actually different
 * (text, an edit, thread activity, files). With `syncReactions`, each message's cached reactions
 * are made to match the payload's — history and replies payloads carry the full list, events don't.
 */
async function storeMessages(
  conversation: Conversation,
  client: WebClient,
  payloads: SlackMessagePayload[],
  options: { syncReactions: boolean }
): Promise<Message[]> {
  const messages = payloads.filter((m): m is SlackMessagePayload & { ts: string } => Boolean(m.ts));
  if (messages.length === 0) return [];

  const userIds = new Set<string>();
  for (const m of messages) {
    if (m.user) userIds.add(m.user);
    for (const id of mentionedUserIds(m.text ?? "")) userIds.add(id);
    if (options.syncReactions) for (const r of m.reactions ?? []) for (const u of r.users ?? []) userIds.add(u);
  }
  const users = await ensureWorkspaceUsers(conversation.workspaceId, client, userIds);

  const existing = await prisma.message.findMany({
    where: { conversationId: conversation.id, slackTs: { in: messages.map((m) => m.ts) } },
    select: { id: true, slackTs: true, raw: true },
  });
  const existingByTs = new Map(existing.map((m) => [m.slackTs, m]));

  const toCreate = messages.filter((m) => !existingByTs.has(m.ts));
  const created =
    toCreate.length === 0
      ? []
      : await prisma.message.createManyAndReturn({
          data: toCreate.map((m) => ({
            conversationId: conversation.id,
            slackTs: m.ts,
            threadTs: m.thread_ts ?? m.ts,
            authorId: m.user ? (users.get(m.user)?.id ?? null) : null,
            text: m.text ?? "",
            isEdited: Boolean(m.edited),
            raw: m as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });

  for (const m of messages) {
    const row = existingByTs.get(m.ts);
    if (!row || messageFingerprint(row.raw as SlackMessagePayload) === messageFingerprint(m)) continue;
    await prisma.message.update({
      where: { id: row.id },
      data: { text: m.text ?? "", isEdited: Boolean(m.edited), raw: m as Prisma.InputJsonValue },
    });
  }

  if (options.syncReactions) {
    const rowIdByTs = new Map<string, string>([
      ...existing.map((r) => [r.slackTs, r.id] as const),
      ...created.map((r) => [r.slackTs, r.id] as const),
    ]);
    const desired: ReactionKey[] = [];
    const partial = new Set<string>();
    for (const m of messages) {
      const messageId = rowIdByTs.get(m.ts);
      if (!messageId) continue;
      for (const r of m.reactions ?? []) {
        if (!r.name) continue;
        if ((r.users?.length ?? 0) < (r.count ?? 0)) partial.add(`${messageId}|${r.name}`);
        for (const u of r.users ?? []) {
          const user = users.get(u);
          if (user) desired.push({ messageId, emoji: r.name, slackUserId: user.id });
        }
      }
    }
    const current = await prisma.reaction.findMany({
      where: { messageId: { in: [...rowIdByTs.values()] } },
      select: { id: true, messageId: true, emoji: true, slackUserId: true },
    });
    const { toAdd, toRemove } = diffReactions(current, desired, partial);
    if (toRemove.length > 0) await prisma.reaction.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } });
    if (toAdd.length > 0) await prisma.reaction.createMany({ data: toAdd, skipDuplicates: true });
  }

  return created;
}

/**
 * The newest cached root (non-reply) message in a conversation, if any. A direct query rather than
 * scanning recent rows: a busy thread can easily put dozens of replies after the last root.
 */
async function latestRootMessage(conversationId: string): Promise<{ slackTs: string } | null> {
  const [row] = await prisma.$queryRaw<{ slackTs: string }[]>`
    SELECT "slackTs" FROM "Message"
    WHERE "conversationId" = ${conversationId}
      AND ("threadTs" IS NULL OR "threadTs" = "slackTs")
    ORDER BY "slackTs" DESC
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Records that the user has seen messages up to this point, clearing the unread indicator. Only
 * ever moves the cursor forward (the open conversation calls this on every poll) unless `rewind`
 * is set, which "mark unread from here" uses. When the cursor actually moves it's also pushed to
 * Slack via conversations.mark, so reading here clears the badge in Slack's own apps too — only
 * when the installation was granted the write scope that needs (see SLACK_EXTRA_USER_SCOPES).
 */
export async function markConversationRead(
  userId: string,
  conversationId: string,
  lastReadTs: string,
  options: { rewind?: boolean; pushToSlack?: boolean } = {}
): Promise<void> {
  const existing = await prisma.readState.findUnique({ where: { userId_conversationId: { userId, conversationId } } });
  if (existing && (existing.lastReadTs === lastReadTs || (!options.rewind && existing.lastReadTs > lastReadTs))) return;

  const rewinding = Boolean(existing && lastReadTs < existing.lastReadTs);
  await prisma.readState.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    update: { lastReadTs, rewoundAt: rewinding ? new Date() : null },
    create: { userId, conversationId, lastReadTs },
  });

  if (options.pushToSlack === false) return;
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return;
  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  if (!installation || !canMarkReadInSlack(installation.scopes, conversation.type)) return;
  try {
    const client = getSlackClientForInstallation(installation);
    await client.conversations.mark({ channel: conversation.slackConversationId, ts: lastReadTs });
  } catch (err) {
    const code = (err as { data?: { error?: string } }).data?.error;
    if (code !== "missing_scope" && code !== "not_allowed_token_type") {
      logger.warn("Failed to push read cursor to Slack", { code, message: (err as Error).message });
    }
  }
}

const MAX_READ_CURSOR_CHECKS = 8;
const READ_CURSOR_CONCURRENCY = 4;

/**
 * Pulls Slack's own read cursor for conversations this app still thinks are unread, so reading a
 * message in Slack's official app clears it here too. Slack has no read-cursor event on the Events
 * API, so this is polled — but only for locally-unread conversations, and only a few per pass (the
 * most recently active half, plus a random sample of the rest so nothing is starved) to stay well
 * inside conversations.info's rate limit. Runs *before* the heavier message sync so it still
 * completes on platforms with short request timeouts.
 */
export async function syncReadCursorsFromSlack(
  userId: string,
  installation: { workspaceId: string },
  client?: WebClient
): Promise<void> {
  const [conversations, readStates] = await Promise.all([
    prisma.conversation.findMany({
      where: { workspaceId: installation.workspaceId, isMember: true, isArchived: false, lastMessageTs: { not: null } },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      select: { id: true, slackConversationId: true, lastMessageTs: true },
    }),
    prisma.readState.findMany({ where: { userId }, select: { conversationId: true, lastReadTs: true, rewoundAt: true } }),
  ]);
  const readMap = new Map(readStates.map((r) => [r.conversationId, r]));
  const unread = conversations.filter((c) => {
    const lastRead = readMap.get(c.id)?.lastReadTs;
    return !lastRead || lastRead < c.lastMessageTs!;
  });
  if (unread.length === 0) return;

  const recentHalf = Math.ceil(MAX_READ_CURSOR_CHECKS / 2);
  const sample = unread
    .slice(recentHalf)
    .map((c) => ({ c, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, MAX_READ_CURSOR_CHECKS - recentHalf)
    .map(({ c }) => c);
  const toCheck = [...unread.slice(0, recentHalf), ...sample];

  const slack = client ?? (await getSlackClientForWorkspace(userId, installation.workspaceId));
  let updated = 0;
  await mapWithConcurrency(toCheck, READ_CURSOR_CONCURRENCY, async (conversation) => {
    const info = await slack.conversations.info({ channel: conversation.slackConversationId }).catch(() => null);
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
    if (local && slackLastRead <= local.lastReadTs) return;
    // "Mark unread from here" (when it couldn't be mirrored to Slack) wins over a Slack cursor for
    // messages from before the rewind, or it would be undone on the next pass. Reading something
    // newer in Slack still counts.
    if (local?.rewoundAt && tsToDate(slackLastRead).getTime() < local.rewoundAt.getTime()) return;

    await markConversationRead(userId, conversation.id, slackLastRead, { pushToSlack: false });
    updated++;
  });
  if (updated > 0) logger.info("Synced read cursors from Slack", { checked: toCheck.length, updated });
}

/** Returns this conversation's members, resolved to display names (used by the @-mention picker). */
export async function listConversationMembers(
  userId: string,
  conversation: Conversation
): Promise<{ id: string; displayName: string }[]> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  const memberIds = await fetchConversationMemberIds(client, conversation.slackConversationId);
  const users = await ensureWorkspaceUsers(conversation.workspaceId, client, memberIds);
  return memberIds.flatMap((id) => {
    const user = users.get(id);
    return user ? [{ id: user.slackUserId, displayName: user.displayName }] : [];
  });
}

/**
 * Fetches the conversations the authorizing user is a member of and brings the cache in line —
 * writing only what's new or changed, and fetching DM/group-DM members only the first time a
 * conversation is seen (their membership is fixed in Slack). Public channels the user has left are
 * flagged rather than lingering in the list.
 */
export async function syncConversationsForUser(
  userId: string,
  options: { includeUsers?: boolean } = {}
): Promise<void> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return;

  const client = await getSlackClientForWorkspace(userId, installation.workspaceId);
  if (options.includeUsers ?? true) {
    await syncWorkspaceUsers(installation.workspaceId, client).catch((err) =>
      logger.error("Failed to bulk-sync workspace users", { message: (err as Error).message })
    );
  }

  const known = new Map(
    (
      await prisma.conversation.findMany({
        where: { workspaceId: installation.workspaceId },
        include: { _count: { select: { members: true } } },
      })
    ).map((c) => [c.slackConversationId, c])
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
      if (!channel.id) continue;
      const existing = known.get(channel.id);

      if ((channel.is_channel || channel.is_group) && channel.is_member === false) {
        if (existing?.isMember) {
          await prisma.conversation.update({ where: { id: existing.id }, data: { isMember: false } });
        }
        continue;
      }

      const fields = conversationFields(channel);
      let conversation: Conversation;
      if (!existing) {
        const created = await upsertConversation(installation.workspaceId, channel);
        if (!created) continue;
        conversation = created;
      } else if (
        existing.type !== fields.type ||
        existing.name !== fields.name ||
        existing.topic !== fields.topic ||
        existing.isArchived !== fields.isArchived ||
        existing.isMember !== fields.isMember
      ) {
        conversation = await prisma.conversation.update({ where: { id: existing.id }, data: fields });
      } else {
        conversation = existing;
      }

      // conversations.list doesn't report last-activity time, so the first time we see a
      // conversation, pull its latest message once to seed real ordering (later kept fresh by
      // the sweep and the events webhook).
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
      if ((existing?._count.members ?? 0) > 0) continue;
      if (channel.is_im && channel.user) {
        const other = await upsertWorkspaceUser(installation.workspaceId, client, channel.user);
        await upsertConversationMember(conversation.id, other.id);
      } else if (channel.is_mpim) {
        const memberIds = (await fetchConversationMemberIds(client, conversation.slackConversationId)).filter(
          (id) => id !== installation.slackUserId
        );
        const members = await ensureWorkspaceUsers(installation.workspaceId, client, memberIds);
        for (const member of members.values()) await upsertConversationMember(conversation.id, member.id);
      }
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

/**
 * Claims the right to notify this user about this message. Returns false when it has already been
 * claimed — by the webhook, by another concurrent poll, or by this poll on an earlier pass — so a
 * push goes out exactly once per (user, message) no matter how many paths see the message.
 */
async function claimNotification(userId: string, messageId: string): Promise<boolean> {
  try {
    await prisma.messageNotification.create({ data: { userId, messageId } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

/** Whether the user started, or has replied in, the thread rooted at `threadTs`. */
async function participatesInThread(conversationId: string, threadTs: string, selfRowId: string): Promise<boolean> {
  const count = await prisma.message.count({
    where: { conversationId, authorId: selfRowId, OR: [{ slackTs: threadTs }, { threadTs }] },
  });
  return count > 0;
}

/**
 * Pushes a notification for one newly arrived message, if the user's settings allow it. Shared by
 * the webhook and the polling sweep; claimNotification makes sure only one of them ever sends it.
 */
async function notifyNewMessage(
  userId: string,
  conversation: Conversation,
  message: Message,
  self: { slackUserId: string; rowId: string | undefined }
): Promise<void> {
  if (!message.authorId || message.authorId === self.rowId) return;

  const isThreadReply = Boolean(message.threadTs && message.threadTs !== message.slackTs);
  const allowed = await notificationAllowed(userId, {
    conversationId: conversation.id,
    conversationType: conversation.type,
    text: message.text,
    selfSlackUserId: self.slackUserId,
    isThreadReply,
    inThread: isThreadReply && self.rowId ? await participatesInThread(conversation.id, message.threadTs!, self.rowId) : false,
  });
  if (!allowed) return;
  if (!(await claimNotification(userId, message.id))) return;

  const mentioned = mentionedUserIds(message.text);
  const [author, mentionedUsers] = await Promise.all([
    prisma.slackUser.findUnique({ where: { id: message.authorId } }),
    mentioned.length > 0
      ? prisma.slackUser.findMany({ where: { workspaceId: conversation.workspaceId, slackUserId: { in: mentioned } } })
      : Promise.resolve([]),
  ]);
  const names = Object.fromEntries(mentionedUsers.map((u) => [u.slackUserId, u.displayName]));
  const authorName = author?.displayName ?? "New message";
  const isChannel = conversation.type === "PUBLIC_CHANNEL" || conversation.type === "PRIVATE_CHANNEL";

  await sendPushToUser(userId, {
    title: isChannel && conversation.name ? `${authorName} in #${conversation.name}` : authorName,
    body: slackTextToPlain(message.text, names) || "Sent an attachment",
    url: `/app/${conversation.id}`,
  }).catch((err) => logger.error("Failed to send push notification", { message: (err as Error).message }));
}

export interface SyncMessagesOptions {
  /** Page size for conversations.history. */
  limit?: number;
  /** Reuse a client the caller already has (the sweep shares one across conversations). */
  client?: WebClient;
  /**
   * Also re-read the most recent messages instead of only asking for newer ones. Without the
   * events webhook (e.g. running on localhost) this is the only way edits, deletions, reactions
   * and new thread replies made in Slack ever reach the cache, since `oldest` never returns a
   * message twice.
   */
  reconcile?: boolean;
  /** With `reconcile`, also re-read this open thread's replies (edits/deletions inside it). */
  threadTs?: string;
}

const MAX_HISTORY_PAGES = 5;
// Thread replies picked up by the backfill only notify while they're fresh; older ones are history.
const REPLY_NOTIFY_WINDOW_MS = 30 * 60_000;

/**
 * Fetches history for a conversation and upserts it into the DB. When messages are already
 * cached, only fetches what's newer than the latest cached message (via `oldest`) instead of
 * re-pulling the last `limit` every time — this is what keeps new messages appearing even when
 * the Events API webhook isn't reaching this deployment. Pages until it has caught up, so a burst
 * of more than `limit` messages between polls doesn't leave a gap — up to MAX_HISTORY_PAGES; a
 * longer backlog (say, a busy channel after days with the app closed) keeps only the newest pages,
 * since there's no backwards pagination. Returns the messages that genuinely just arrived (nothing
 * on the very first backfill, which shouldn't notify).
 */
export async function syncMessages(
  userId: string,
  conversation: Conversation,
  options: SyncMessagesOptions = {}
): Promise<Message[]> {
  const client = options.client ?? (await getSlackClientForWorkspace(userId, conversation.workspaceId));
  const limit = options.limit ?? 50;

  // Only root messages count as "the latest" here: conversations.history never returns thread
  // replies, and a reply cached via the webhook can be newer than any root. Using a reply's ts as
  // `oldest` would skip roots posted before it, and treating it as the conversation's last
  // message keeps the conversation "unread" after Slack's own read cursor (which only tracks
  // roots) has moved past everything.
  const latestCached = await latestRootMessage(conversation.id);
  const reconcile = Boolean(options.reconcile && latestCached);

  const fetched: SlackMessagePayload[] = [];
  let cursor: string | undefined;
  let pages = 0;
  // Nothing posted after this moment can be in the response; bounds the deletion check below.
  const requestedAt = (Date.now() / 1000).toFixed(6);
  do {
    const res = await client.conversations.history({
      channel: conversation.slackConversationId,
      limit,
      cursor,
      ...(latestCached && !reconcile ? { oldest: latestCached.slackTs } : {}),
    });
    fetched.push(...((res.messages ?? []) as SlackMessagePayload[]));
    cursor = res.has_more ? res.response_metadata?.next_cursor || undefined : undefined;
    pages++;
    // The first sync is just the most recent page. After that, keep going until we've reached
    // what's already cached.
    const oldestFetched = fetched[fetched.length - 1]?.ts;
    if (!latestCached || (oldestFetched && oldestFetched <= latestCached.slackTs)) break;
  } while (cursor && pages < MAX_HISTORY_PAGES);

  const created = await storeMessages(conversation, client, fetched, { syncReactions: true });
  if (reconcile) await markMissingAsDeleted(conversation.id, fetched, requestedAt);

  // Keep lastMessageTs pointing at the newest *root* message (see latestRootMessage) — this also
  // repairs rows that were previously advanced by a thread reply. History also carries replies
  // "also sent to the channel" (thread_broadcast); they're stored as replies, so they mustn't
  // become the latest message or the read cursor (which follows roots) could never reach it.
  const newestFetchedRoot = fetched.find((m) => m.ts && (!m.thread_ts || m.thread_ts === m.ts))?.ts;
  const latestRoot = newestFetchedRoot ?? latestCached?.slackTs;
  if (latestRoot && latestRoot !== conversation.lastMessageTs) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: tsToDate(latestRoot), lastMessageTs: latestRoot },
    });
  }

  const replies = await backfillStaleThreads(conversation, client).catch((err) => {
    logger.error("Failed to backfill thread replies", { message: (err as Error).message });
    return [] as Message[];
  });
  if (reconcile && options.threadTs) {
    await syncThreadReplies(conversation, client, options.threadTs).catch((err) =>
      logger.warn("Failed to refresh open thread", { message: (err as Error).message })
    );
  }

  if (!latestCached) return [];
  const freshReplies = replies.filter((r) => Date.now() - tsToDate(r.slackTs).getTime() < REPLY_NOTIFY_WINDOW_MS);
  return [...created, ...freshReplies];
}

/**
 * After re-reading the most recent stretch of history, any cached root message inside that stretch
 * that Slack no longer returns has been deleted in Slack. The stretch runs from the oldest message
 * Slack returned up to when the request was made — not just to the newest one returned, or a
 * deleted latest message would never be noticed. Older cached history is never touched (on Slack's
 * free plan, old messages drop out of history without being deleted).
 */
async function markMissingAsDeleted(
  conversationId: string,
  fetched: SlackMessagePayload[],
  requestedAt: string
): Promise<void> {
  const tsList = fetched.map((m) => m.ts).filter((ts): ts is string => Boolean(ts));
  if (tsList.length === 0) return;
  const oldest = tsList[tsList.length - 1];
  const present = new Set(tsList);

  const cached = await prisma.message.findMany({
    where: { conversationId, deletedAt: null, slackTs: { gte: oldest, lte: requestedAt } },
    select: { id: true, slackTs: true, threadTs: true },
  });
  const gone = cached.filter((m) => (!m.threadTs || m.threadTs === m.slackTs) && !present.has(m.slackTs));
  if (gone.length > 0) {
    await prisma.message.updateMany({ where: { id: { in: gone.map((m) => m.id) } }, data: { deletedAt: new Date() } });
  }
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

async function backfillStaleThreads(conversation: Conversation, client: WebClient): Promise<Message[]> {
  const stale = await findStaleThreadRoots(conversation.id);
  const created: Message[] = [];
  for (const root of stale) {
    created.push(...(await syncThreadReplies(conversation, client, root.slackTs)));
  }
  return created;
}

/**
 * Fetches every reply in a thread via conversations.replies and upserts them (the root itself is
 * skipped — it's already synced as a normal history message). When the whole thread was read,
 * cached replies Slack no longer has are marked deleted. Returns the replies that were new.
 */
async function syncThreadReplies(conversation: Conversation, client: WebClient, threadTs: string): Promise<Message[]> {
  const created: Message[] = [];
  const seen = new Set<string>();
  let complete = true;
  let cursor: string | undefined;
  do {
    const res = await client.conversations
      .replies({ channel: conversation.slackConversationId, ts: threadTs, limit: 200, cursor })
      .catch(() => null);
    if (!res) {
      complete = false;
      break;
    }

    const replies = ((res.messages ?? []) as SlackMessagePayload[])
      .filter((reply) => reply.ts && reply.ts !== threadTs)
      .map((reply) => ({ ...reply, thread_ts: reply.thread_ts ?? threadTs }));
    for (const reply of replies) seen.add(reply.ts!);
    created.push(...(await storeMessages(conversation, client, replies, { syncReactions: true })));

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  if (complete) {
    const cached = await prisma.message.findMany({
      where: { conversationId: conversation.id, threadTs, deletedAt: null, NOT: { slackTs: threadTs } },
      select: { id: true, slackTs: true },
    });
    const gone = cached.filter((m) => !seen.has(m.slackTs));
    if (gone.length > 0) {
      await prisma.message.updateMany({ where: { id: { in: gone.map((m) => m.id) } }, data: { deletedAt: new Date() } });
    }
  }
  return created;
}

// Several open tabs/devices each poll the list; only one of them needs to run the Slack sweep.
const LIST_SYNC_MIN_INTERVAL_MS = 12_000;
// Each conversation costs a Slack history call, and conversations.history allows roughly 50 a
// minute. So a sweep looks at the few most active conversations every time, plus a rotating slice
// of the rest (least recently polled first) — every conversation gets checked within a few sweeps,
// however many there are, without blowing the rate limit. SYNC_BUDGET_MS keeps the request well
// inside platform timeouts.
const HOT_CONVERSATIONS_PER_SWEEP = 3;
const ROTATING_CONVERSATIONS_PER_SWEEP = 5;
const SWEEP_CONCURRENCY = 3;
const SYNC_BUDGET_MS = 8000;

/**
 * Catches up conversations for a user and pushes a notification for each genuinely new message
 * from someone else. This is the polling-based stand-in for the Events API webhook path (which
 * also notifies, in `handleMessageEvent`) — it's what lets unread highlighting and notifications
 * work even when the webhook isn't reaching this deployment.
 */
export async function syncAllConversationsAndNotify(userId: string): Promise<void> {
  const installation = await getActiveInstallation(userId);
  if (!installation) return;

  // Atomic claim: whichever tab/device gets here first within the window does the work, the rest
  // just read the list. Without this, three open tabs meant three concurrent sweeps that could
  // each see the same new message.
  const claimed = await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ lastListSyncAt: null }, { lastListSyncAt: { lt: new Date(Date.now() - LIST_SYNC_MIN_INTERVAL_MS) } }],
    },
    data: { lastListSyncAt: new Date() },
  });
  if (claimed.count === 0) return;

  const client = getSlackClientForInstallation(installation, { background: true });
  const baseWhere = { workspaceId: installation.workspaceId, isMember: true, isArchived: false };
  const hot = await prisma.conversation.findMany({
    where: baseWhere,
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    take: HOT_CONVERSATIONS_PER_SWEEP,
  });
  const [rotating, self] = await Promise.all([
    prisma.conversation.findMany({
      where: { ...baseWhere, id: { notIn: hot.map((c) => c.id) } },
      orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }],
      take: ROTATING_CONVERSATIONS_PER_SWEEP,
    }),
    prisma.slackUser.findUnique({
      where: {
        workspaceId_slackUserId: { workspaceId: installation.workspaceId, slackUserId: installation.slackUserId },
      },
    }),
  ]);

  await syncReadCursorsFromSlack(userId, installation, client).catch((err) =>
    logger.warn("Failed to sync read cursors from Slack", { message: (err as Error).message })
  );

  const startedAt = Date.now();
  const polled: string[] = [];
  let skipped = 0;

  await mapWithConcurrency([...hot, ...rotating], SWEEP_CONCURRENCY, async (conversation) => {
    if (Date.now() - startedAt > SYNC_BUDGET_MS) {
      skipped++;
      return;
    }

    let arrived: Message[];
    try {
      arrived = await syncMessages(userId, conversation, { limit: 20, client });
      polled.push(conversation.id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Counted as polled unless Slack merely asked us to slow down — a conversation that always
      // fails (say, a private channel you were removed from) must not hog the front of the queue.
      if (code !== "slack_webapi_rate_limited_error") polled.push(conversation.id);
      logger.warn("Failed to sync conversation during list refresh", { code, message: (err as Error).message });
      return;
    }

    for (const message of arrived) {
      await notifyNewMessage(userId, conversation, message, { slackUserId: installation.slackUserId, rowId: self?.id });
    }
  });

  if (polled.length > 0) {
    await prisma.conversation.updateMany({ where: { id: { in: polled } }, data: { lastPolledAt: new Date() } });
  }
  if (skipped > 0) logger.warn("Stopped conversation sync early to stay within the time budget", { skipped });
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

  const client = getSlackClientForInstallation(installation);
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

/**
 * Deletes a message the authorizing user sent (soft-deletes locally, mirroring the webhook path).
 * A message Slack no longer has is already gone, so that counts as success.
 */
export async function deleteMessage(userId: string, conversation: Conversation, message: Message): Promise<void> {
  const client = await getSlackClientForWorkspace(userId, conversation.workspaceId);
  try {
    await client.chat.delete({ channel: conversation.slackConversationId, ts: message.slackTs });
  } catch (err) {
    if ((err as { data?: { error?: string } }).data?.error !== "message_not_found") throw err;
  }

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

  const client = getSlackClientForInstallation(installation);
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

  await syncMessages(userId, conversation, { client, threadTs: upload.threadTs, reconcile: Boolean(upload.threadTs) });
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

  const client = getSlackClientForInstallation(installation);
  await client.reactions
    .add({ channel: conversation.slackConversationId, timestamp: message.slackTs, name: emoji })
    .catch((err) => {
      // Reacting twice (e.g. a double click racing the refresh) is already the state we want.
      if ((err as { data?: { error?: string } }).data?.error !== "already_reacted") throw err;
    });

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

  const client = getSlackClientForInstallation(installation);
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

  const client = getSlackClientForInstallation(installation);

  if (event.type === "message") {
    await handleMessageEvent(workspace.id, client, event, {
      userId: installation.userId,
      selfSlackUserId: installation.slackUserId,
    });
  } else if (event.type === "reaction_added" || event.type === "reaction_removed") {
    await handleReactionEvent(workspace.id, client, event, event.type === "reaction_added");
  }
}

// Subtypes that describe a change to an existing message (carried in `event.message`) rather than
// a new one: an edit or unfurl (message_changed), or a parent whose thread just got a reply.
const CHANGE_SUBTYPES = new Set(["message_changed", "message_replied"]);

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

  // For a change, the message itself is nested; storing the envelope instead would lose its files
  // and reply_count, and flagging every message_changed as an edit marked unfurls as "(edited)".
  const isChange = CHANGE_SUBTYPES.has(event.subtype ?? "");
  const payload = (isChange ? event.message : event) as SlackMessagePayload | undefined;
  if (!payload?.ts) return;

  const created = await storeMessages(conversation, client, [payload], { syncReactions: false });
  const ts = payload.ts;
  const threadTs = payload.thread_ts ?? ts;

  if (threadTs === ts && !isChange && (!conversation.lastMessageTs || ts > conversation.lastMessageTs)) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: tsToDate(ts), lastMessageTs: ts },
    });
  }

  if (isChange || created.length === 0) return;
  const self = await prisma.slackUser.findUnique({
    where: { workspaceId_slackUserId: { workspaceId, slackUserId: notify.selfSlackUserId } },
  });
  await notifyNewMessage(notify.userId, conversation, created[0], {
    slackUserId: notify.selfSlackUserId,
    rowId: self?.id,
  });
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
