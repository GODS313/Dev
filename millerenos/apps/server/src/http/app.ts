import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyError } from 'fastify';
import client from 'prom-client';
import { basePath } from '../config.js';
import { AppError } from '../lib/errors.js';
import { safeEqual, sha256 } from '../lib/crypto.js';
import { scrubSecrets } from '../logger.js';
import { webRoutes } from '../web/site.js';
import { adminRoutes } from './admin.js';
import { apiRoutes } from './api.js';
import type { Services } from './context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MINIAPP_DIR = path.resolve(here, '../../../miniapp/dist');

const SITE_CSP =
  "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";
// Website checkout embeds the official Telegram Login Widget (script + oauth iframe).
const CHECKOUT_CSP =
  "default-src 'self'; script-src https://telegram.org; frame-src https://oauth.telegram.org; style-src 'self'; " +
  "img-src 'self' data: https://telegram.org https://t.me; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
  "form-action 'self'; frame-ancestors 'none'";
// The Mini App runs inside Telegram clients (including web.telegram.org iframes).
const MINIAPP_CSP =
  "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
  'frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org';

export const metrics = (() => {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpDuration: new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    telegramUpdates: new client.Counter({
      name: 'telegram_updates_total',
      help: 'Telegram updates',
      labelNames: ['result'],
      registers: [registry],
    }),
  };
})();

export async function buildApp(s: Services, opts: { miniappDir?: string } = {}) {
  const bp = basePath(s.cfg);
  const app = Fastify({
    loggerInstance: s.log as unknown as FastifyBaseLogger,
    trustProxy: s.cfg.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    genReqId: (req) => {
      const given = req.headers['x-request-id'];
      return typeof given === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(given) ? given : randomUUID();
    },
  });

  // HTML forms (website checkout) post urlencoded bodies.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // set per surface below
    crossOriginEmbedderPolicy: false,
    frameguard: false, // controlled via CSP frame-ancestors
    hsts: s.cfg.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Authenticated calls are limited per session, anonymous calls per IP (sign-in is IP-limited).
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth?.startsWith('Bearer ') ? `s:${sha256(auth.slice(7)).toString('base64url').slice(0, 22)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError('rate_limited', 'Too many requests', { retryAfterSeconds: Math.ceil(ctx.ttl / 1000) });
      return err;
    },
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    (req as unknown as { _t: bigint })._t = process.hrtime.bigint();
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const url = bp && req.url.startsWith(bp) ? req.url.slice(bp.length) : req.url;
    if (url.startsWith('/app')) reply.header('content-security-policy', MINIAPP_CSP);
    else if (/^\/(en|fa)\/checkout/.test(url)) reply.header('content-security-policy', CHECKOUT_CSP);
    else if (!url.startsWith('/api/') && !url.startsWith('/tg/')) reply.header('content-security-policy', SITE_CSP);
    else reply.header('cache-control', 'no-store');
    if (url.startsWith('/api/admin') || url.startsWith('/app')) reply.header('x-robots-tag', 'noindex, nofollow');
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as unknown as { _t?: bigint })._t;
    if (!start) return;
    const route = req.routeOptions.url ?? 'unmatched';
    metrics.httpDuration.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      Number(process.hrtime.bigint() - start) / 1e9,
    );
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.warn({ code: err.code }, err.message);
      if (err.code === 'rate_limited' && err.details?.retryAfterSeconds) reply.header('retry-after', String(err.details.retryAfterSeconds));
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    const fe = err as FastifyError;
    if (fe.statusCode && fe.statusCode < 500) {
      const code = fe.statusCode === 413 ? 'bad_request' : fe.statusCode === 429 ? 'rate_limited' : 'bad_request';
      return reply
        .code(fe.statusCode)
        .send({ error: { code, message: fe.statusCode === 413 ? 'Payload too large' : 'Bad request', requestId: req.id } });
    }
    req.log.error({ err: { message: scrubSecrets(String(err.message)), stack: scrubSecrets(String(err.stack ?? '')) } }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong', requestId: req.id } });
  });

  // All routes live under the base path (e.g. /God when PUBLIC_BASE_URL is https://host/God).
  await app.register(
    async (r) => {
      // ── Health & metrics ─────────────────────────────────────────────────────
      r.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));
      r.get('/readyz', { config: { rateLimit: false } }, async (_req, reply) => {
        try {
          await s.db.app.query('SELECT 1');
          return { ok: true, db: 'up' };
        } catch {
          return reply.code(503).send({ ok: false, db: 'down' });
        }
      });
      r.get('/metrics', { config: { rateLimit: false } }, async (req, reply) => {
        const token = s.cfg.METRICS_TOKEN;
        const given = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!token || !safeEqual(given, token))
          return reply.code(404).send({ error: { code: 'not_found', message: 'Not found', requestId: req.id } });
        return reply.header('content-type', metrics.registry.contentType).send(await metrics.registry.metrics());
      });

      // ── Telegram webhook ─────────────────────────────────────────────────────
      r.post('/tg/webhook', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (req, reply) => {
        const secret = s.cfg.TELEGRAM_WEBHOOK_SECRET;
        const given = req.headers['x-telegram-bot-api-secret-token'];
        if (!s.handleUpdate || !secret || typeof given !== 'string' || !safeEqual(given, secret)) {
          metrics.telegramUpdates.inc({ result: 'rejected' });
          return reply.code(401).send({ error: { code: 'unauthorized', message: 'Unauthorized', requestId: req.id } });
        }
        const update = req.body as { update_id?: unknown };
        if (!update || typeof update !== 'object' || typeof update.update_id !== 'number') {
          return reply.code(400).send({ error: { code: 'bad_request', message: 'Bad update', requestId: req.id } });
        }
        try {
          await s.handleUpdate(update);
          metrics.telegramUpdates.inc({ result: 'ok' });
        } catch (err) {
          metrics.telegramUpdates.inc({ result: 'error' });
          req.log.error({ err: scrubSecrets(String(err)) }, 'telegram update failed');
          // Payment updates must not be lost: answer 5xx so Telegram redelivers (processing is idempotent).
          // Other failures answer 200 so one poison update cannot block the queue.
          const msg = (update as { message?: { successful_payment?: unknown } }).message;
          if (msg?.successful_payment) {
            return reply.code(503).send({ error: { code: 'internal', message: 'Retry', requestId: req.id } });
          }
        }
        return { ok: true };
      });

      await apiRoutes(r, s);
      await adminRoutes(r, s);

      // ── Mini App static files ────────────────────────────────────────────────
      const miniappDir = opts.miniappDir ?? DEFAULT_MINIAPP_DIR;
      if (existsSync(miniappDir)) {
        // relative asset URLs need the trailing slash
        r.get('/app', async (_req, reply) => reply.redirect(`${bp}/app/`, 301));
        await r.register(fastifyStatic, {
          root: miniappDir,
          prefix: '/app/',
          index: 'index.html',
          setHeaders: (res, filePath) => {
            res.header('cache-control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');
          },
        });
      } else {
        r.get('/app/', async (_req, reply) => reply.code(503).type('text/plain').send('Mini App build not found. Run npm run build.'));
      }

      const notFoundPage = webRoutes(r, { cfg: s.cfg, db: s.db });
      r.setNotFoundHandler((req, reply) => {
        const path = req.url.slice(bp.length);
        if (path.startsWith('/api/') || path.startsWith('/tg/')) {
          return reply.code(404).send({ error: { code: 'not_found', message: 'Not found', requestId: req.id } });
        }
        return notFoundPage(req.url.split('?')[0]!, reply);
      });
    },
    { prefix: bp },
  );

  return app;
}
