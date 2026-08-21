import { NextResponse } from "next/server";
import { constantTimeEqual, consumeRateLimit, ensureAccount, ensureSchema, executeBuy, executeSell, formatNumber, getPrice, isAllowedChat, markUpdate, notifySlack, portfolioText, runtimeEnv, sendTelegram, userFacingError, withChatLock } from "../../../../lib/trading";

export const dynamic = "force-dynamic";

type TelegramUpdate = { update_id?: number; message?: { text?: string; chat?: { id?: number } } };

export async function POST(request: Request) {
  const expected = runtimeEnv.TELEGRAM_WEBHOOK_SECRET ?? "";
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !constantTimeEqual(expected, received)) return NextResponse.json({ ok: false }, { status: 401 });

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > 65_536) return NextResponse.json({ ok: false }, { status: 413 });
  let update: TelegramUpdate;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 65_536) return NextResponse.json({ ok: false }, { status: 413 });
    update = JSON.parse(rawBody) as TelegramUpdate;
  }
  catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const updateId = update.update_id;
  const chatIdValue = update.message?.chat?.id;
  const text = update.message?.text?.trim();
  if (!Number.isInteger(updateId) || !chatIdValue || !text) return NextResponse.json({ ok: true });
  const chatId = String(chatIdValue);
  if (!isAllowedChat(chatId)) return NextResponse.json({ ok: true });

  const db = runtimeEnv.DB;
  await ensureSchema(db);
  if (!(await markUpdate(db, updateId!, chatId))) return NextResponse.json({ ok: true });
  if (!(await consumeRateLimit(db, chatId))) { await sendTelegram(chatId, "⏳ درخواست‌ها زیاد است؛ یک دقیقه دیگر تلاش کنید."); return NextResponse.json({ ok: true }); }
  await ensureAccount(db, chatId);

  const [rawCommand, symbolArg, amountArg] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().split("@")[0];
  try {
    if (command === "/start" || command === "/help") {
      await sendTelegram(chatId, ["🤖 <b>آلفا ترید — حالت آزمایشی</b>", "", "/price BTC — قیمت", "/buy BTC 100 — خرید با تتر", "/sell BTC 0.002 — فروش مقدار دارایی", "/portfolio — مشاهده سبد", "/risk 2 — تعیین ریسک ۰.۵ تا ۵ درصد", "/pause — توقف", "/resume — ادامه", "", "هیچ سفارش واقعی ارسال نمی‌شود."].join("\n"));
    } else if (command === "/price") {
      const quote = await getPrice(symbolArg ?? "");
      await sendTelegram(chatId, `💹 ${quote.symbol}: <b>$${formatNumber(quote.price, 2)}</b>`);
    } else if (command === "/buy") {
      const trade = await withChatLock(db, chatId, () => executeBuy(db, chatId, symbolArg ?? "", Number(amountArg)));
      await sendTelegram(chatId, `✅ <b>خرید آزمایشی ثبت شد</b>\n${trade.symbol}: ${formatNumber(trade.quantity, 8)}\nمبلغ: $${formatNumber(trade.quoteAmount, 2)}\nقیمت: $${formatNumber(trade.price, 2)}\nحالت: PAPER`);
      await notifySlack(trade);
    } else if (command === "/sell") {
      const trade = await withChatLock(db, chatId, () => executeSell(db, chatId, symbolArg ?? "", Number(amountArg)));
      await sendTelegram(chatId, `✅ <b>فروش آزمایشی ثبت شد</b>\n${trade.symbol}: ${formatNumber(trade.quantity, 8)}\nمبلغ: $${formatNumber(trade.quoteAmount, 2)}\nقیمت: $${formatNumber(trade.price, 2)}\nحالت: PAPER`);
      await notifySlack(trade);
    } else if (command === "/portfolio") {
      await sendTelegram(chatId, await portfolioText(db, chatId));
    } else if (command === "/pause" || command === "/resume") {
      const paused = command === "/pause" ? 1 : 0;
      await withChatLock(db, chatId, () => db.prepare("UPDATE accounts SET paused = ?, updated_at = ? WHERE chat_id = ?").bind(paused, Date.now(), chatId).run());
      await sendTelegram(chatId, paused ? "⏸ معاملات متوقف شد." : "▶️ معاملات آزمایشی فعال شد.");
    } else if (command === "/risk") {
      const risk = Number(symbolArg);
      if (!Number.isFinite(risk) || risk < 0.5 || risk > 5) throw new Error("INVALID_AMOUNT");
      await withChatLock(db, chatId, () => db.prepare("UPDATE accounts SET risk_percent = ?, updated_at = ? WHERE chat_id = ?").bind(risk, Date.now(), chatId).run());
      await sendTelegram(chatId, `🛡 سقف ریسک هر خرید روی ${risk}% تنظیم شد.`);
    } else {
      await sendTelegram(chatId, "دستور ناشناخته است. /help را بفرستید.");
    }
  } catch (error) { await sendTelegram(chatId, userFacingError(error)); }
  return NextResponse.json({ ok: true });
}

export async function GET() { return NextResponse.json({ ok: false }, { status: 405 }); }
