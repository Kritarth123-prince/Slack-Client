import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getAccessibleConversation } from "@/server/services/access";
import { listConversationMembers } from "@/lib/slack/sync";
import { logger } from "@/lib/logger";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const conversation = await getAccessibleConversation(userId, id);
  if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const members = await listConversationMembers(userId, conversation);
    return NextResponse.json({ members });
  } catch (err) {
    logger.error("Failed to list conversation members", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
