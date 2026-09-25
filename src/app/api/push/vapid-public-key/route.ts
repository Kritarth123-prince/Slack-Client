import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export async function GET() {
  return NextResponse.json({ publicKey: getEnv().VAPID_PUBLIC_KEY });
}
