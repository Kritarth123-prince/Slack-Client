import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(`${getEnv().APP_BASE_URL}/login`);
}
