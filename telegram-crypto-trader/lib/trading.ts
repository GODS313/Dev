import { env as cloudflareEnv } from "cloudflare:workers";

type RuntimeEnv = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOWED_CHAT_IDS?: string;
  SLACK_WEBHOOK_URL?: string;
  TRADING_MODE?: string;
  PUBLIC_BASE_URL?: string;
  SETUP_SECRET?: string;
};

export const runtimeEnv = cloudflareEnv as unknown as RuntimeEnv;

const assetIds: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", ADA: "cardano", DOGE: "dogecoin",
};
const PRICE_API_BASE = "https://api.coingecko.com/api/v3";

export async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS accounts (chat_id TEXT PRIMARY KEY, cash_usdt REAL NOT NULL DEFAULT 10000, paused INTEGER NOT NULL DEFAULT 0, risk_percent REAL NOT NULL DEFAULT 2, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS holdings (chat_id TEXT NOT NULL, symbol TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, average_price REAL NOT NULL DEFAULT 0, PRIMARY KEY (chat_id, symbol))"),
    db.prepare("CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, side TEXT NOT NULL, symbol TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, quote_amount REAL NOT NULL, mode TEXT NOT NULL DEFAULT 'paper', created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS telegram_updates (update_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, received_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS rate_limits (chat_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, request_count INTEGER NOT NULL DEFAULT 1)"),
    db.prepare("CREATE TABLE IF NOT EXISTS trade_locks (chat_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
  ]);
}

export function isAllowedChat(chatId: string) {
  const allowed = (runtimeEnv.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.length > 0 && allowed.includes(chatId);
}

export function constantTimeEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function markUpdate(db: D1Database, updateId: number, chatId: string) {
  const result = await db.prepare("INSERT OR IGNORE INTO telegram_updates (update_id, chat_id, received_at) VALUES (?, ?, ?)")
    .bind(updateId, chatId, Date.now()).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function consumeRateLimit(db: D1Database, chatId: string) {
  const now = Date.now();
  const admitted = await db.prepare("INSERT INTO rate_limits (chat_id, window_start, request_count) VALUES (?, ?, 1) ON CONFLICT(chat_id) DO UPDATE SET window_start = CASE WHEN ? - window_start >= 60000 THEN ? ELSE window_start END, request_count = CASE WHEN ? - window_start >= 60000 THEN 1 ELSE request_count + 1 END WHERE ? - window_start >= 60000 OR request_count < 20 RETURNING request_count AS requestCount")
    .bind(chatId, now, now, now, now, now).first<{ requestCount: number }>();
  return Boolean(admitted);
}

export async function withChatLock<T>(db: D1Database, chatId: string, action: () => Promise<T>) {
  const now = Date.now();
  const token = crypto.randomUUID();
  const results = await db.batch([
    db.prepare("DELETE FROM trade_locks WHERE chat_id = ? AND expires_at <= ?").bind(chatId, now),
    db.prepare("INSERT OR IGNORE INTO trade_locks (chat_id, token, expires_at) VALUES (?, ?, ?)").bind(chatId, token, now + 20_000),
  ]);
  if (Number(results[1]?.meta.changes ?? 0) !== 1) throw new Error("ACCOUNT_BUSY");
  try { return await action(); }
  finally { await db.prepare("DELETE FROM trade_locks WHERE chat_id = ? AND token = ?").bind(chatId, token).run(); }
}

export async function ensureAccount(db: D1Database, chatId: string) {
  const now = Date.now();
  await db.prepare("INSERT OR IGNORE INTO accounts (chat_id, cash_usdt, paused, risk_percent, created_at, updated_at) VALUES (?, 10000, 0, 2, ?, ?)").bind(chatId, now, now).run();
}

export async function getPrice(symbolInput: string) {
  const symbol = symbolInput.toUpperCase();
  const id = assetIds[symbol];
  if (!id) throw new Error("UNSUPPORTED_ASSET");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch(`${PRICE_API_BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`, {
      headers: { accept: "application/json", "user-agent": "alpha-trade-paper-bot/0.1" }, signal: controller.signal,
    });
    if (!response.ok) throw new Error("PRICE_UNAVAILABLE");
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > 65_536) throw new Error("PRICE_UNAVAILABLE");
    const rawBody = await response.text();
    if (rawBody.length > 65_536) throw new Error("PRICE_UNAVAILABLE");
    const body = JSON.parse(rawBody) as Record<string, { usd?: number }>;
    const price = body[id]?.usd;
    if (!Number.isFinite(price) || !price || price <= 0) throw new Error("PRICE_UNAVAILABLE");
    return { symbol, price };
  } finally { clearTimeout(timeout); }
}

export async function executeBuy(db: D1Database, chatId: string, symbolInput: string, quoteAmount: number) {
  if ((runtimeEnv.TRADING_MODE ?? "paper") !== "paper") throw new Error("LIVE_MODE_DISABLED");
  const account = await db.prepare("SELECT cash_usdt AS cashUsdt, paused, risk_percent AS riskPercent FROM accounts WHERE chat_id = ?").bind(chatId).first<{ cashUsdt: number; paused: number; riskPercent: number }>();
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  if (account.paused) throw new Error("TRADING_PAUSED");
  if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) throw new Error("INVALID_AMOUNT");
  const maxTrade = account.cashUsdt * (account.riskPercent / 100);
  if (quoteAmount > maxTrade || quoteAmount > account.cashUsdt) throw new Error("RISK_LIMIT");
  const { symbol, price } = await getPrice(symbolInput);
  const quantity = quoteAmount / price;
  const current = await db.prepare("SELECT quantity, average_price AS averagePrice FROM holdings WHERE chat_id = ? AND symbol = ?").bind(chatId, symbol).first<{ quantity: number; averagePrice: number }>();
  const oldQty = current?.quantity ?? 0;
  const newQty = oldQty + quantity;
  const averagePrice = ((oldQty * (current?.averagePrice ?? 0)) + quoteAmount) / newQty;
  await db.batch([
    db.prepare("UPDATE accounts SET cash_usdt = cash_usdt - ?, updated_at = ? WHERE chat_id = ?").bind(quoteAmount, Date.now(), chatId),
    db.prepare("INSERT INTO holdings (chat_id, symbol, quantity, average_price) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, symbol) DO UPDATE SET quantity = excluded.quantity, average_price = excluded.average_price").bind(chatId, symbol, newQty, averagePrice),
    db.prepare("INSERT INTO trades (chat_id, side, symbol, quantity, price, quote_amount, mode, created_at) VALUES (?, 'BUY', ?, ?, ?, ?, 'paper', ?)").bind(chatId, symbol, quantity, price, quoteAmount, Date.now()),
  ]);
  return { side: "BUY", symbol, quantity, price, quoteAmount } as const;
}

export async function executeSell(db: D1Database, chatId: string, symbolInput: string, quantity: number) {
  if ((runtimeEnv.TRADING_MODE ?? "paper") !== "paper") throw new Error("LIVE_MODE_DISABLED");
  const account = await db.prepare("SELECT paused FROM accounts WHERE chat_id = ?").bind(chatId).first<{ paused: number }>();
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  if (account.paused) throw new Error("TRADING_PAUSED");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("INVALID_AMOUNT");
  const { symbol, price } = await getPrice(symbolInput);
  const holding = await db.prepare("SELECT quantity FROM holdings WHERE chat_id = ? AND symbol = ?").bind(chatId, symbol).first<{ quantity: number }>();
  if (!holding || holding.quantity + 1e-12 < quantity) throw new Error("INSUFFICIENT_ASSET");
  const quoteAmount = quantity * price;
  await db.batch([
    db.prepare("UPDATE accounts SET cash_usdt = cash_usdt + ?, updated_at = ? WHERE chat_id = ?").bind(quoteAmount, Date.now(), chatId),
    db.prepare("UPDATE holdings SET quantity = quantity - ? WHERE chat_id = ? AND symbol = ?").bind(quantity, chatId, symbol),
    db.prepare("INSERT INTO trades (chat_id, side, symbol, quantity, price, quote_amount, mode, created_at) VALUES (?, 'SELL', ?, ?, ?, ?, 'paper', ?)").bind(chatId, symbol, quantity, price, quoteAmount, Date.now()),
  ]);
  return { side: "SELL", symbol, quantity, price, quoteAmount } as const;
}

export async function portfolioText(db: D1Database, chatId: string) {
  const account = await db.prepare("SELECT cash_usdt AS cashUsdt, paused, risk_percent AS riskPercent FROM accounts WHERE chat_id = ?").bind(chatId).first<{ cashUsdt: number; paused: number; riskPercent: number }>();
  const holdings = await db.prepare("SELECT symbol, quantity, average_price AS averagePrice FROM holdings WHERE chat_id = ? AND quantity > 0.00000001 ORDER BY symbol").bind(chatId).all<{ symbol: string; quantity: number; averagePrice: number }>();
  const lines = holdings.results.map((item) => `• ${item.symbol}: ${formatNumber(item.quantity, 8)} (میانگین $${formatNumber(item.averagePrice, 2)})`);
  return [`📊 سبد آزمایشی`, `💵 موجودی: $${formatNumber(account?.cashUsdt ?? 0, 2)} USDT`, `🛡 ریسک: ${account?.riskPercent ?? 2}%`, `${account?.paused ? "⏸ متوقف" : "✅ فعال"}`, "", ...(lines.length ? lines : ["هنوز دارایی خریداری نشده است."])].join("\n");
}

export async function notifySlack(trade: { side: string; symbol: string; quantity: number; price: number; quoteAmount: number }) {
  if (!runtimeEnv.SLACK_WEBHOOK_URL) return;
  let destination: URL;
  try { destination = new URL(runtimeEnv.SLACK_WEBHOOK_URL); }
  catch { return; }
  if (destination.protocol !== "https:" || destination.hostname !== "hooks.slack.com" || destination.port || !destination.pathname.startsWith("/services/") || destination.username || destination.password) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(destination.toString(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Alpha Trade · PAPER ${trade.side} · ${trade.symbol} · $${formatNumber(trade.quoteAmount, 2)} @ $${formatNumber(trade.price, 2)}` }), signal: controller.signal, redirect: "error" });
  } catch { /* Alerts must never alter trade state. */ }
  finally { clearTimeout(timeout); }
}

export async function sendTelegram(chatId: string, text: string) {
  if (!runtimeEnv.TELEGRAM_BOT_TOKEN) throw new Error("BOT_NOT_CONFIGURED");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  const response = await fetch(`https://api.telegram.org/bot${runtimeEnv.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }), signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
}

export function formatNumber(value: number, digits: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function userFacingError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const messages: Record<string, string> = {
    UNSUPPORTED_ASSET: "این ارز پشتیبانی نمی‌شود. BTC, ETH, SOL, BNB, XRP, ADA یا DOGE را انتخاب کنید.",
    PRICE_UNAVAILABLE: "قیمت بازار فعلاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
    TRADING_PAUSED: "معاملات متوقف است. برای ادامه /resume را بفرستید.",
    INVALID_AMOUNT: "مقدار واردشده معتبر نیست.", RISK_LIMIT: "این سفارش از سقف ریسک حساب بیشتر است.",
    INSUFFICIENT_ASSET: "موجودی این دارایی کافی نیست.", LIVE_MODE_DISABLED: "ارسال سفارش واقعی در این نسخه غیرفعال است.",
    ACCOUNT_BUSY: "یک دستور دیگر در حال اجراست؛ چند ثانیه بعد دوباره تلاش کنید.",
  };
  return `⚠️ ${messages[code] ?? "عملیات انجام نشد."}`;
}
