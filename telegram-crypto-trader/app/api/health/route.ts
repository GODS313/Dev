import { NextResponse } from "next/server";
import { runtimeEnv } from "../../../lib/trading";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ status: "ok", mode: runtimeEnv.TRADING_MODE ?? "paper", telegramConfigured: Boolean(runtimeEnv.TELEGRAM_BOT_TOKEN && runtimeEnv.TELEGRAM_WEBHOOK_SECRET && runtimeEnv.TELEGRAM_ALLOWED_CHAT_IDS), slackConfigured: Boolean(runtimeEnv.SLACK_WEBHOOK_URL) }, { headers: { "cache-control": "no-store" } });
}
