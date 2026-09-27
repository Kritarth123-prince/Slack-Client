import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { getPreferences, updatePreferences, type UpdatePreferencesInput } from "@/server/services/preferences";
import { logger } from "@/lib/logger";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    return NextResponse.json(await getPreferences(userId));
  } catch (err) {
    logger.error("Failed to load preferences", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

const THEMES = ["system", "light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export async function PATCH(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const input: UpdatePreferencesInput = {
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    theme: THEMES.includes(body.theme as (typeof THEMES)[number]) ? (body.theme as UpdatePreferencesInput["theme"]) : undefined,
    density: DENSITIES.includes(body.density as (typeof DENSITIES)[number])
      ? (body.density as UpdatePreferencesInput["density"])
      : undefined,
    notifyDirectMessages: typeof body.notifyDirectMessages === "boolean" ? body.notifyDirectMessages : undefined,
    notifyMentions: typeof body.notifyMentions === "boolean" ? body.notifyMentions : undefined,
    notifyThreadReplies: typeof body.notifyThreadReplies === "boolean" ? body.notifyThreadReplies : undefined,
    notifyChannelMessages: typeof body.notifyChannelMessages === "boolean" ? body.notifyChannelMessages : undefined,
    quietHoursStart: optionalString(body.quietHoursStart),
    quietHoursEnd: optionalString(body.quietHoursEnd),
    timezone: optionalString(body.timezone),
  };

  try {
    return NextResponse.json(await updatePreferences(userId, input));
  } catch (err) {
    logger.error("Failed to update preferences", { message: (err as Error).message });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
