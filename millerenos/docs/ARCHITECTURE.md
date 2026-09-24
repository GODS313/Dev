# Millerenos — Architecture

Status: Phase 1 (MVP) foundation. Last reviewed: 2026-09-24.

## 1. Discovery summary (environment inventory)

| Item | Finding | Consequence |
|---|---|---|
| Repository `GODS313/Dev` | Already hosts the **Hamkare / Adlisho** production project at the repo root (Cloudflare Pages output dir `/`, PHP panels, Python bots, VPS scripts). | Millerenos lives entirely in `millerenos/`. **No existing file was modified**, so no backup was needed. Root CI (`release-checks.yml`) is unaffected. |
| Hosting of repo root | Cloudflare Pages publishes the repo root as static files. | Merged to `main`, the `millerenos/` sources could become publicly downloadable from the Hamkare site. See "IP exposure" in `SECURITY.md`. Recommended: move Millerenos into its own private repository before merging to `main`. |
| Toolchain | Node 22, PostgreSQL 16, Docker, gpg, age available in dev container. | TypeScript on Node 22 LTS, PostgreSQL 16. |
| Credentials | None provided (no bot token, no Anthropic key, no server, no domain). | All integrations run in "not configured" mode with clear status; nothing pretends to be live. |

## 2. Principles

1. **Modular monolith first.** One deployable Node service (HTTP API + Telegram webhook + SEO website) plus one worker process, sharing one PostgreSQL database. Modules have clean boundaries (`src/modules/*`) so any of them can be extracted later. No microservices until load or team size demands it.
2. **PostgreSQL is the source of truth.** Also used for the job queue (`FOR UPDATE SKIP LOCKED`), rate-limit buckets for sensitive operations, idempotency keys and analytics events. Redis is optional later; nothing requires it now.
3. **Tenant isolation in two layers.** Application code always scopes by `workspace_id`; PostgreSQL Row-Level Security (RLS) enforces the same boundary even if application code has a bug.
4. **Server is authoritative.** Identity (Telegram init-data HMAC), trial timers, quotas, prices and payment state are decided only on the server.
5. **Integrations are adapters with honest status.** Every external platform/provider implements an interface and declares `OFFICIAL_SUPPORTED | LIMITED_SUPPORTED | EXPERIMENTAL | UNAVAILABLE`. Production use is additionally gated by feature flags.
6. **Boring, well-licensed dependencies.** See `docs/LICENSES.md`.

## 3. System diagram

```
                 ┌──────────────── Public web (SSR, /en/ /fa/) ───────────────┐
 Search engines ─┤  SEO pages, sitemap.xml, robots.txt, hreflang, deep links    │
                 └──────────────────────────────┬─────────────────────────────┘
                                                │ t.me/<bot>?start=<src>
 Telegram users ──► Telegram Bot API ──webhook──►│
                                                ▼
                  ┌──────────────── millerenos server (Fastify) ───────────────┐
 Mini App (Preact)│  /tg/webhook  (secret-token verified, grammY)              │
 served at /app ──►  /api/v1/*    (session auth, RBAC, tenant tx + RLS)         │
                  │  /admin API   (platform_role + audit log)                  │
                  │  /healthz /readyz /metrics                                 │
                  │  modules: identity · workspace · trial · billing ·         │
                  │   commerce · ai · analytics · support · channels ·         │
                  │   domains · flags · audit                                  │
                  └───────────────┬──────────────────────────────┬─────────────┘
                                  │                              │
                          PostgreSQL 16 (RLS)            worker process
                                  │                     (jobs: trial expiry,
                          encrypted backups              notifications, retention)
```

## 4. Repository layout

```
millerenos/
  apps/server/src/
    config.ts            env parsing + validation (zod); fails fast
    logger.ts            pino with secret redaction
    db/                  pool, migrations runner, tenant transaction helper
    migrations/          ordered SQL migrations (tracked in schema_migrations)
    http/                Fastify app, auth hooks, error model, API v1 routes
    bot/                 Telegram bot (grammY): menus, i18n, payments
    web/                 server-rendered public site (SEO, i18n, sitemap)
    modules/<domain>/    business logic, one folder per bounded context
    i18n/                translation catalogs (en, fa)
    worker.ts            background job runner
  apps/miniapp/          Telegram Mini App (Preact + Vite), built into server static dir
  ops/                   Dockerfile, compose, backup/restore scripts, systemd units
  docs/                  all architecture, security and operations docs
```

## 5. Key decisions (ADR log)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| ADR-1 | TypeScript + Node 22 + Fastify | NestJS, Express, Go | Typed, fast, small surface, one language for server + Mini App. |
| ADR-2 | PostgreSQL + plain SQL migrations + `pg` | Prisma, Drizzle, TypeORM | Full control of RLS, constraints and indexes; no ORM magic in the security boundary. |
| ADR-3 | RLS with `SET LOCAL app.workspace_id` inside a transaction | App-only filtering; schema-per-tenant | Defense in depth with low operational cost; scales to many tenants. |
| ADR-4 | grammY for Telegram, webhook mode with `secret_token` | Telegraf, raw API | Maintained, typed, MIT, supports Stars payments & Mini Apps. |
| ADR-5 | Opaque session tokens (stored as SHA-256 hash) | JWT | Revocable, no key-rotation pitfalls, trivial logout. |
| ADR-6 | Public site is SSR from the same server with template functions | Next.js, Astro | Zero client JS required for crawlability, tiny attack surface; can migrate to a framework later without URL changes. |
| ADR-7 | Mini App: Preact + Vite | React, Vue, vanilla | ~10 KB runtime, fast startup inside Telegram. |
| ADR-8 | Postgres-backed job queue | Redis/BullMQ | One less stateful service in Phase 1. |
| ADR-9 | AI via provider interface; default provider Anthropic (`claude-opus-5`), configurable | Hard-coded vendor | Swappable; merchant-controlled modes; grounded prompts; audit log. |
| ADR-10 | Digital goods inside Telegram paid with **Telegram Stars (XTR)** | Card gateways in-bot | Required by Telegram rules for digital goods/services. |
| ADR-11 | Node built-in test runner (`node:test`) | Vitest/Jest | Zero extra dependency; vitest install was blocked by an npm resolver bug. |

## 6. Request lifecycle (API)

1. `onRequest`: request id (`x-request-id`), rate limit, security headers.
2. Auth hook: `Authorization: Bearer <session>` → session lookup by hash → `ctx.user`.
3. Workspace routes: membership + role check (`owner|admin|staff`) → `withTenant(workspaceId, fn)` opens a transaction, sets `app.workspace_id`, runs queries; RLS rejects anything outside the tenant.
4. Validation with zod; errors mapped to a stable JSON error model `{ error: { code, message, requestId } }`.
5. Structured log line (no secrets, no message bodies).

## 7. Scaling path (do not build before needed)

- Horizontal: server is stateless (sessions in DB) → run N replicas behind a load balancer; the in-memory HTTP rate limiter moves to Redis at that point.
- Read replicas for analytics; partition `analytics_events` by month.
- Extract `ai`, `channels` or `billing` into services only when their load/team justifies it.
