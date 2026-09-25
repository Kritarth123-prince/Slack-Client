import type { WebClient } from "@slack/web-api";
import { ConversationType, type Conversation, type Message, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSlackClientForUser } from "@/lib/slack/client";
import type { SlackEventEnvelope } from "@/lib/slack/events";
import { sendPushToUser } from "@/lib/push";
import { logger } from "@/lib/logger";

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

/** Records that the user has seen messages up to this point, clearing the unread indicator. */
export async function markConversationRead(userId: string, conversationId: string, lastReadTs: string): Promise<void> {
  await prisma.readState.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    update: { lastReadTs },
    create: { userId, conversationId, lastReadTs },
  });
}

/** Returns this conversation's members, resolved to display names (used by the @-mention picker). */
export async function listConversationMembers(
  userId: string,
  conversation: Conversation
): Promise<{ id: string; displayName: string }[]> {
  const client = await getSlackClientForUser(userId);
  const memberIds = await fetchConversationMemberIds(client, conversation.slackConversationId);
  const users = await Promise.all(memberIds.map((id) => upsertWorkspaceUser(conversation.workspaceId, client, id)));
  return users.map((u) => ({ id: u.slackUserId, displayName: u.displayName }));
}

/** Fetches the conversations the authorizing user is a member of and upserts them. */
export async function syncConversationsForUser(userId: string): Promise<void> {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return;

  const client = await getSlackClientForUser(userId);
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

/**
 * Fetches history for a conversation and upserts it into the DB. When messages are already
 * cached, only fetches what's newer than the latest cached message (via `oldest`) instead of
 * re-pulling the last `limit` every time — this is what keeps new messages appearing even when
 * the Events API webhook isn't reaching this deployment (e.g. a stale/misconfigured Request URL,
 * or the platform blocking the callback before it reaches our handler).
 */
export async function syncMessages(userId: string, conversation: Conversation, limit = 50): Promise<void> {
  const client = await getSlackClientForUser(userId);

  const latestCached = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { slackTs: "desc" },
    select: { slackTs: true },
  });

  const res = await client.conversations.history({
    channel: conversation.slackConversationId,
    limit,
    ...(latestCached ? { oldest: latestCached.slackTs } : {}),
  });

  for (const msg of res.messages ?? []) {
    if (!msg.ts) continue;

    let authorId: string | null = null;
    if (msg.user) {
      const author = await upsertWorkspaceUser(conversation.workspaceId, client, msg.user);
      authorId = author.id;
    }
    if (msg.text) await resolveMentionedUsers(conversation.workspaceId, client, msg.text);

    await prisma.message.upsert({
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
  }

  const latestTs = res.messages?.[0]?.ts;
  if (latestTs) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: tsToDate(latestTs), lastMessageTs: latestTs },
    });
  }
}

/** Sends a message as the authorizing user, then upserts it locally so the UI reflects it instantly. */
export async function postMessage(
  userId: string,
  conversation: Conversation,
  text: string,
  threadTs?: string
): Promise<void> {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForUser(userId);
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

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: tsToDate(res.ts), lastMessageTs: res.ts },
  });
}

/** Edits a message the authorizing user sent, then reflects the new text locally. */
export async function editMessage(
  userId: string,
  conversation: Conversation,
  message: Message,
  text: string
): Promise<void> {
  const client = await getSlackClientForUser(userId);
  await client.chat.update({ channel: conversation.slackConversationId, ts: message.slackTs, text });
  await resolveMentionedUsers(conversation.workspaceId, client, text);

  await prisma.message.update({
    where: { id: message.id },
    data: { text, isEdited: true },
  });
}

/** Deletes a message the authorizing user sent (soft-deletes locally, mirroring the webhook path). */
export async function deleteMessage(userId: string, conversation: Conversation, message: Message): Promise<void> {
  const client = await getSlackClientForUser(userId);
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
    const client = await getSlackClientForUser(userId);
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
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForUser(userId);
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

/** Adds an emoji reaction as the authorizing user, then reflects it locally without waiting on the webhook. */
export async function addReaction(
  userId: string,
  conversation: Conversation,
  message: Message,
  emoji: string
): Promise<void> {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForUser(userId);
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
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) throw new Error("No active Slack installation for user");

  const client = await getSlackClientForUser(userId);
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

  const client = await getSlackClientForUser(installation.userId);

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

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: tsToDate(ts), lastMessageTs: ts },
  });

  if (isNewMessage && authorSlackId && authorSlackId !== notify.selfSlackUserId) {
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
