# Security

Status: Phase 1. This document lists controls that **exist in code today**, the threat model, and the results of
authorized defensive testing performed on Millerenos' own code in a local environment.

## 1. Threat model (STRIDE summary)

| Asset | Threat | Control (implemented) | Test |
|---|---|---|---|
| Tenant data (products, orders, customers) | Cross-tenant read/write (IDOR/BOLA, tenant escape) | Membership check → 404 for non-members; every query scoped by `workspace_id`; PostgreSQL RLS (`FORCE`) with `app.workspace_id` set per transaction; composite FKs `(workspace_id, id)` prevent cross-tenant references | `tenant-isolation.test.ts` |
| User identity | Forged Mini App identity | Server-side HMAC validation of Telegram `initData`, max age 1h, bots rejected | `unit.test.ts` |
| Sessions | Theft / replay | 256-bit random opaque tokens, only SHA-256 stored, expiry, revocation on logout/block/role change | `tenant-isolation.test.ts` |
| Telegram webhook | Forged updates | `X-Telegram-Bot-Api-Secret-Token` compared in constant time; 401 otherwise | `payments.test.ts` |
| Payments | Duplicate charge / replay / tampering | Server-side price; pre-checkout re-validation (amount, currency, payer, expiry); `webhook_events (provider,event_id)` + `payments (provider, provider_charge_id)` unique; mismatches recorded & flagged, never auto-applied | `payments.test.ts` |
| Orders | Price tampering, overselling, double submit | Prices read from DB; `SELECT … FOR UPDATE` on variants; stock check; idempotency key unique per workspace | `commerce.test.ts` (incl. race) |
| Trial | Trial farming | One trial per user (unique), per Telegram identity (HMAC claim survives deletion), global hourly cap, blocked users refused, concurrency-safe | `trial.test.ts` |
| AI | Prompt injection, hallucinated prices/policies | Grounding rules; merchant data and customer text wrapped in tags with `<`/`>` neutralized; suggestions never auto-sent; merchant modes; quotas; audit log | `ai.test.ts` |
| Admin surface | Privilege escalation | Platform roles checked per route; admin routes return 404 to non-staff; superadmin-only for flags/refunds/roles; self-demotion/blocking prevented; all mutations audited | `tenant-isolation.test.ts` |
| Public site | XSS, clickjacking | All output HTML-escaped; JSON-LD `<` escaped; CSP `script-src 'none'`, `frame-ancestors 'none'` | `web.test.ts` |
| Mini App | XSS, framing | Preact escapes by default (no `dangerouslySetInnerHTML`); CSP allows only self + telegram.org script; framing only by Telegram web clients | `web.test.ts` |
| Secrets | Leakage in logs/errors | pino redaction list (`logger.ts`), `scrubSecrets()` for bot tokens / API keys / DB URLs, config errors never print values, generic 500 bodies with request id | `unit.test.ts` |
| Availability | Brute force / flooding | Global 300 req/min per session or IP, stricter per-route limits (auth 20/min, trial 5/min, AI 20/min), per-Telegram-user bot flood limiter, body limit 256 KB, statement timeout 15 s | `bot.test.ts` |
| Mass assignment | Overwriting protected fields | zod `.strict()` schemas on updates | `commerce.test.ts` |
| Crypto checkout (web) | Forged login, CSRF, open redirect, fake tokens, replayed tx, underpayment | Login Widget HMAC check, cookie HttpOnly/Secure/SameSite, session-bound CSRF token + Origin check, redirect allow-list, official USDT contract + recipient check, confirmed tx only, tx id dedupe, exact amount + time window, mismatches flagged | `crypto.test.ts` |
| Static files | Path traversal | `@fastify/static` ≥ 10.1.4 (patched GHSA-83w8-p2f5-377r / GHSA-8pvw-jcv7-9cmj) | `web.test.ts` |
| Backups | Data exposure | `age` public-key encryption, private key offline, `umask 077`, checksum, dedicated read-only `BYPASSRLS` role | restore test (see BACKUP_RESTORE.md) |

Not applicable today (documented so they are not forgotten):
- **CSRF**: the API uses bearer tokens (no cookies), so browsers cannot attach credentials cross-site. If cookie auth is ever added, add SameSite=strict + CSRF tokens.
- **SSRF**: the server makes no requests to user-supplied URLs. Domain/hosting providers (Phase 2) must use an allow-list of provider hosts and `isValidDomainLabel()`.
- **File uploads**: none in Phase 1. When added: size/type allow-list, magic-byte check, re-encode images, private bucket + short-lived signed URLs.
- **Passwords**: none; authentication is via Telegram. If email/password admin login is added, use argon2id.

## 2. Database roles (least privilege)

| Role | Used by | Rights |
|---|---|---|
| `millerenos_owner` | migrations only | owns schema |
| `millerenos_app` | HTTP API tenant queries | DML on tables; **RLS enforced**; no access to `jobs`, `webhook_events`, `account_deletion_requests`, `backup_runs`; append-only on `audit_logs`, `analytics_events` |
| `millerenos_system` | admin API, worker, public store resolution, payments | cross-tenant via explicit `system_all` policies |
| `millerenos_backup` | `pg_dump` | `pg_read_all_data` + `BYPASSRLS`, read-only |

## 3. Security testing performed (2026-09-24, local, own code only)

Automated in CI on every change: 80 tests. Highlights of what was attacked and the result:

| Test | Result |
|---|---|
| Read/modify another workspace via 7 endpoints | 404, no data |
| Use own workspace id + foreign product id (IDOR) | 404; price unchanged |
| Attach foreign category to own product | 422 |
| Unfiltered SQL inside tenant transaction | 0 foreign rows; insert with foreign `workspace_id` rejected by RLS |
| Forged / expired / re-signed init data, bot accounts | rejected |
| Forged bearer token, token after logout, token after block | 401 |
| Webhook without / with wrong secret | 401 |
| Stars pre-checkout with changed amount or different payer | rejected |
| Same `successful_payment` delivered twice | one payment, one activation |
| Payment amount ≠ invoice | recorded, flagged `payment.needs_review`, not applied |
| Double refund | 409 |
| 3 concurrent buyers for the last unit | exactly 1 succeeds, stock 0 |
| 5 concurrent trial starts | exactly 1 trial, 1 workspace |
| Delete account → re-register same Telegram id → trial | refused |
| Client-supplied `priceMinor` on order | ignored |
| Unknown fields on workspace update (`owner_user_id`) | 422 |
| Prompt injection closing `</customer_message>` | neutralized |
| Path traversal on `/app/` | blocked |
| 40 bot messages in a burst from one user | ≤ 30 processed |

**Findings fixed during this build**
1. Account deletion endpoint used the tenant DB role (permission error → feature broken). Fixed to use the system role; covered by test.
2. `@fastify/static` < 10.1.4 had two high-severity advisories. Upgraded; audit is now clean and enforced in CI.
3. Backups: `pg_dump` as owner failed under `FORCE ROW LEVEL SECURITY` — a silent-failure risk. Added a dedicated backup role and a restore test that proves the dump contains all tenants.
4. Rate limiting keyed only by IP would lock out users behind shared NAT (common on mobile carriers). Authenticated requests are now limited per session.

**Still to do before public launch** (tracked in BACKLOG.md): external penetration test, dependency scanning alerts (Dependabot/Renovate), WAF/CDN in front, secret rotation runbook drill, Telegram `initData` Ed25519 third-party validation if the Mini App is ever opened via a different bot.

## 4. Responsible disclosure
`/.well-known/security.txt` is served. Set `SECURITY_CONTACT` (e.g. `mailto:security@<domain>`) in production.

## 5. IP exposure note (important)
This repository's root is published by Cloudflare Pages for the Hamkare site. If `millerenos/` is merged into `main`
of this repository, its source code could become downloadable from that site. **Keep Millerenos on its branch or,
better, move it to a dedicated private repository before merging.**
