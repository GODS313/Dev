import { NextResponse } from "next/server";
import { constantTimeEqual, runtimeEnv } from "../../../../lib/trading";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!runtimeEnv.SETUP_SECRET || !constantTimeEqual(runtimeEnv.SETUP_SECRET, provided)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!runtimeEnv.TELEGRAM_BOT_TOKEN || !runtimeEnv.TELEGRAM_WEBHOOK_SECRET || !runtimeEnv.PUBLIC_BASE_URL) return NextResponse.json({ ok: false, error: "missing_configuration" }, { status: 503 });
  let base: URL;
  try { base = new URL(runtimeEnv.PUBLIC_BASE_URL); }
  catch { return NextResponse.json({ ok: false, error: "invalid_public_url" }, { status: 400 }); }
  if (base.protocol !== "https:") return NextResponse.json({ ok: false, error: "invalid_public_url" }, { status: 400 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const response = await fetch(`https://api.telegram.org/bot${runtimeEnv.TELEGRAM_BOT_TOKEN}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: new URL("/api/telegram/webhook", base).toString(), secret_token: runtimeEnv.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ["message"], drop_pending_updates: true }), signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) return NextResponse.json({ ok: false, error: "telegram_rejected" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
