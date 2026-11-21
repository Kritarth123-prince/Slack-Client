import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { syncMessages, postMessage, markConversationRead } from "@/lib/slack/sync";
import { getInstallationForWorkspace } from "@/lib/slack/installation";
import { listTyping, listReaders, clearTyping } from "@/server/services/presenceSignals";
import { getAccessibleConversation } from "@/server/services/access";
import { loadConversationMessages } from "@/server/services/messages";
import { logger } from "@/lib/logger";

const RECONCILE_WINDOW = 30;

/**
 * The open conversation's poll. `?reconcile=1` (sent every few polls) also re-reads the most recent
 * messages so edits, deletions, reactions and thread replies made in Slack show up even without the
 * events webhook; `&thread=<ts>` does the same for the thread panel if one is open. `?read=0` skips
 * moving the read cursor (the tab is open but not being looked at).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await getAccessibleConversation(userId, id);
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const search = request.nextUrl.searchParams;
  const reconcile = search.get("reconcile") === "1";
  const threadTs = search.get("thread") || undefined;

  // Pull anything newer than what's cached on every call (cheap once caught up, since it only
  // asks Slack for messages after the latest cached one). This is what this polling call relies
  // on to surface new messages even when the Events API webhook isn't reaching this deployment.
  try {
    await syncMessages(userId, conversation, reconcile ? { reconcile, threadTs, limit: RECONCILE_WINDOW } : {});
  } catch (err) {
    logger.error("Failed to sync messages", { message: (err as Error).message });
  }

  const view = await loadConversationMessages(userId, conversation);
  if (view.newestRootTs && search.get("read") !== "0") {
    await markConversationRead(userId, conversation.id, view.newestRootTs).catch(() => {});
  }

  const installation = await getInstallationForWorkspace(userId, conversation.workspaceId);
  const self = installation
    ? await prisma.slackUser.findUnique({
        where: {
          workspaceId_slackUserId: { workspaceId: conversation.workspaceId, slackUserId: installation.slackUserId },
        },
        select: { id: true },
      })
    : null;
  const [typing, readers] = await Promise.all([listTyping(conversation.id, self?.id), listReaders(conversation, userId)]);

  return NextResponse.json({
    messages: view.messages,
    userNames: view.userNames,
    clearedBeforeTs: view.clearedBeforeTs,
    typing,
    readers,
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await getAccessibleConversation(userId, id);
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { text?: unknown; threadTs?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_message" }, { status: 400 });
  const threadTs = typeof body?.threadTs === "string" ? body.threadTs : undefined;

  try {
    await postMessage(userId, conversation, text, threadTs);
    await clearTyping(userId, conversation, threadTs ?? "").catch(() => {});
  } catch (err) {
    logger.error("Failed to send Slack message", { message: (err as Error).message });
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

// These call Slack (sometimes several times) per request; the platform default timeout on some
// hosts is 10s, which is easy to hit during a first sync.
export const maxDuration = 60;
