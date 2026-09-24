import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WEBHOOK_SECRET, makeHarness, update } from './helpers.js';

describe('telegram bot journey', () => {
  let h: Awaited<ReturnType<typeof makeHarness>>;
  const from = { id: 5001, is_bot: false, first_name: 'Sara', language_code: 'fa' };
  const chat = { id: 5001, type: 'private', first_name: 'Sara' };
  const send = (body: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/tg/webhook', headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }, payload: update(body) });
  const text = (t: string) => ({ message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat, from, text: t, entities: t.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: t.split(' ')[0]!.length }] : [] } });
  const tap = (data: string) => ({ callback_query: { id: `cb${Math.random()}`, from, chat_instance: '1', data, message: { message_id: 2, date: 0, chat, from: { id: 1, is_bot: true, first_name: 'b' }, text: 'x' } } });
  const last = (method: string) => [...h.calls].reverse().find((c) => c.method === method)!;
  const buttons = (call: { payload: Record<string, unknown> }) =>
    ((call.payload.reply_markup as { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] }).inline_keyboard ?? []).flat();

  before(async () => {
    h = await makeHarness('bot');
  });
  after(() => h.close());

  it('/start from a new user asks for language (Persian guessed) and records the funnel event', async () => {
    await send(text('/start src_instagram'));
    const msg = last('sendMessage');
    assert.match(String(msg.payload.text), /زبان/);
    assert.deepEqual(buttons(msg).map((b) => b.callback_data), ['lang:en', 'lang:fa']);
    const ev = await h.db.system.query(`SELECT props FROM analytics_events WHERE name = 'bot_started'`);
    assert.equal(ev.rows[0].props.source, 'instagram');
  });

  it('choosing a language shows the main menu with a trial button and a Mini App button', async () => {
    await send(tap('lang:en'));
    const edit = last('editMessageText');
    const b = buttons(edit);
    assert.ok(b.some((x) => x.callback_data === 'trial:start'));
    assert.ok(b.some((x) => x.web_app?.url === 'https://millerenos.test/app/'));
  });

  it('starting the trial from the bot creates a workspace once', async () => {
    await send(tap('trial:start'));
    assert.match(String(last('sendMessage').payload.text), /free trial is active/);
    await send(tap('trial:start'));
    assert.match(String(last('sendMessage').payload.text), /already used/);
    const n = await h.db.system.query('SELECT count(*)::int AS n FROM trials');
    assert.equal(n.rows[0].n, 1);
  });

  it('business summary and plans render; buying a plan sends a Stars invoice link', async () => {
    await send(tap('menu:business'));
    assert.match(String(last('editMessageText').payload.text), /Trial/);
    await send(tap('menu:plans'));
    assert.match(String(last('editMessageText').payload.text), /starter/);
    await send(tap('plan:buy:starter'));
    assert.equal(last('createInvoiceLink').payload.currency, 'XTR');
  });

  it('floods from one user are dropped by the per-user limiter', async () => {
    h.calls.length = 0;
    for (let i = 0; i < 40; i++) await send(text('hello'));
    const replies = h.calls.filter((c) => c.method === 'sendMessage').length;
    assert.ok(replies <= 30, `replies=${replies}`);
  });

  it('messages from bots are ignored', async () => {
    h.calls.length = 0;
    await send({ message: { message_id: 1, date: 0, chat, from: { id: 42, is_bot: true, first_name: 'x' }, text: '/start' } });
    assert.equal(h.calls.length, 0);
  });
});
