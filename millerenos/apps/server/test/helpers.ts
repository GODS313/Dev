import { execFileSync } from 'node:child_process';
import type { UserFromGetMe } from 'grammy/types';
import { loadConfig, type Config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { buildApp } from '../src/http/app.js';
import type { Services } from '../src/http/context.js';
import { createLogger } from '../src/logger.js';
import { signInitData } from '../src/modules/identity/telegram-auth.js';
import { createServices } from '../src/services.js';

/**
 * Integration tests run against a real PostgreSQL. Set TEST_DATABASE_ADMIN_URL to a superuser URL
 * (default: local socket as postgres via sudo is used by ops/ci). A fresh database is created per run.
 */
export const BOT_TOKEN = '123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
export const WEBHOOK_SECRET = 'test_webhook_secret_0123456789abcdef';
export const BOT_INFO: UserFromGetMe = {
  id: 123456789,
  is_bot: true,
  first_name: 'Millerenos',
  username: 'millerenos_test_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as UserFromGetMe;

const PG = {
  host: process.env.TEST_PGHOST ?? 'localhost',
  port: process.env.TEST_PGPORT ?? '5432',
  admin: process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
};

function psql(url: string, args: string[]) {
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

export async function setupDatabase(name: string) {
  const db = `millerenos_test_${name}_${process.pid}`;
  psql(PG.admin, ['-c', `DROP DATABASE IF EXISTS ${db}`]);
  psql(PG.admin, [
    '-v',
    'owner_pw=test_owner',
    '-v',
    'app_pw=test_app',
    '-v',
    'system_pw=test_system',
    '-v',
    `db=${db}`,
    '-f',
    new URL('../../../ops/db/bootstrap-roles.sql', import.meta.url).pathname,
  ]);
  const base = (user: string, pw: string) => `postgres://${user}:${pw}@${PG.host}:${PG.port}/${db}`;
  await migrate(base('millerenos_owner', 'test_owner'));
  return {
    name: db,
    appUrl: base('millerenos_app', 'test_app'),
    systemUrl: base('millerenos_system', 'test_system'),
    drop: () => psql(PG.admin, ['-c', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]),
  };
}

export function testConfig(urls: { appUrl: string; systemUrl: string }, overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PUBLIC_BASE_URL: 'https://millerenos.test',
    DATABASE_URL: urls.appUrl,
    DATABASE_SYSTEM_URL: urls.systemUrl,
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: 'millerenos_test_bot',
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PLATFORM_ADMIN_TELEGRAM_IDS: '999',
    METRICS_TOKEN: 'metrics_token_0123456789',
    ...overrides,
  });
}

/** Records every Bot API call instead of sending it. */
export function captureBotApi(services: Services & { bot?: { api: { config: { use: (fn: unknown) => void } } } }) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  services.bot!.api.config.use(async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    const result =
      method === 'createInvoiceLink'
        ? 'https://t.me/$invoice_test'
        : method === 'sendMessage'
          ? { message_id: 1, date: 0, chat: { id: 1, type: 'private' } }
          : true;
    return { ok: true, result } as never;
  });
  return calls;
}

export async function makeHarness(name: string, overrides: Record<string, string> = {}) {
  const pg = await setupDatabase(name);
  const cfg = testConfig(pg, overrides);
  const services = await createServices(cfg, createLogger(cfg.LOG_LEVEL), { botInfo: BOT_INFO });
  const calls = captureBotApi(services as never);
  const app = await buildApp(services, { miniappDir: '/nonexistent' });
  await app.ready();
  return {
    cfg,
    services,
    app,
    calls,
    db: services.db,
    async close() {
      await app.close();
      await services.db.close();
      pg.drop();
    },
  };
}

export function initDataFor(
  user: { id: number; first_name?: string; username?: string; language_code?: string },
  authDate = Math.floor(Date.now() / 1000),
) {
  return signInitData({ auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify({ first_name: 'Test', ...user }) }, BOT_TOKEN);
}

export async function login(h: Awaited<ReturnType<typeof makeHarness>>, tgId: number, extra: Record<string, string> = {}) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/telegram',
    payload: { initData: initDataFor({ id: tgId, ...extra }) },
  });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { token: body.token as string, user: body.user, auth: { authorization: `Bearer ${body.token}` } };
}

export async function loginWithTrial(h: Awaited<ReturnType<typeof makeHarness>>, tgId: number, name = 'Shop') {
  const s = await login(h, tgId);
  const res = await h.app.inject({ method: 'POST', url: '/api/v1/trial', headers: s.auth, payload: { businessName: name } });
  if (res.statusCode !== 200) throw new Error(`trial failed ${res.statusCode} ${res.body}`);
  return { ...s, workspaceId: res.json().workspace.id as string, slug: res.json().workspace.slug as string };
}

let updateId = 1000;
export function update(body: Record<string, unknown>) {
  return { update_id: updateId++, ...body };
}
