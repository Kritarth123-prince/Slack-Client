import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getAccessibleConversation } from "@/server/services/access";
import { clearConversationHistory, restoreConversationHistory } from "@/server/services/conversationHistory";

/** "Clear history" (hide everything so far from this user's view) or undo it. App-local — nothing changes in Slack. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await getAccessibleConversation(userId, id);
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action === "clear") return NextResponse.json(await clearConversationHistory(userId, conversation));
  if (body?.action === "restore") return NextResponse.json(await restoreConversationHistory(userId, conversation.id));
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
