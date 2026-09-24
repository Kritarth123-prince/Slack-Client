import type { WebClient } from "@slack/web-api";
import { ConversationType, type Conversation, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSlackClientForUser } from "@/lib/slack/client";
import type { SlackEventEnvelope } from "@/lib/slack/events";

type SlackEvent = NonNullable<SlackEventEnvelope["event"]>;

interface SlackChannelLike {
  id?: string;
  name?: string;
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

/** Fetches the conversations the authorizing user is a member of and upserts them. */
export async function syncConversationsForUser(userId: string): Promise<void> {
  const installation = await prisma.slackInstallation.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { installedAt: "desc" },
  });
  if (!installation) return;

  const client = await getSlackClientForUser(userId);

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
      await upsertConversation(installation.workspaceId, channel);
    }

    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
}

/** Fetches recent history for a conversation and upserts it into the DB. */
export async function syncMessages(userId: string, conversation: Conversation, limit = 50): Promise<void> {
  const client = await getSlackClientForUser(userId);
  const res = await client.conversations.history({
    channel: conversation.slackConversationId,
    limit,
  });

  for (const msg of res.messages ?? []) {
    if (!msg.ts) continue;

    let authorId: string | null = null;
    if (msg.user) {
      const author = await upsertWorkspaceUser(conversation.workspaceId, client, msg.user);
      authorId = author.id;
    }

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
      data: { lastMessageAt: tsToDate(latestTs) },
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
    data: { lastMessageAt: tsToDate(res.ts) },
  });
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
    await handleMessageEvent(workspace.id, client, event);
  } else if (event.type === "reaction_added" || event.type === "reaction_removed") {
    await handleReactionEvent(workspace.id, client, event, event.type === "reaction_added");
  }
}

async function handleMessageEvent(workspaceId: string, client: WebClient, event: SlackEvent): Promise<void> {
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
  if (authorSlackId) {
    const author = await upsertWorkspaceUser(workspaceId, client, authorSlackId);
    authorId = author.id;
  }

  const text = nested?.text ?? event.text ?? "";
  const threadTs = nested?.thread_ts ?? event.thread_ts ?? ts;

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
    data: { lastMessageAt: tsToDate(ts) },
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
