# Changelog

## [0.2.0] — 2026-09-24 (unreleased)
- Base-path support: the whole platform can run under `https://etebarami.net/God`.
- Plan prices in Telegram Stars, USDT (TRC-20) and TRX; website checkout with Telegram Login Widget, unique-amount
  invoices, TronGrid confirmation polling, exactly-once activation, review flags for mismatches.
- Admin API to change plan prices. Installer and webhook scripts for etebarami.net/God.
- Docker healthcheck follows the base path. 80 tests.

## [0.1.0] — 2026-09-24 (unreleased, not deployed)
First MVP foundation.
- Backend modular monolith (Fastify, PostgreSQL with RLS, migrations, job worker).
- Telegram bot: language selection, 1-hour trial, business summary, plans, Stars checkout, referrals, support entry.
- Mini App: onboarding, trial countdown, activation checklist, products, orders, customers, AI assistant,
  store settings + FAQ, plans, support tickets, account export/deletion, platform admin dashboard, customer storefront.
- Billing: Telegram Stars invoices, pre-checkout validation, exactly-once payments, renewals, admin refunds.
- AI: grounded reply suggestions and product descriptions, merchant modes, quotas, audit log.
- Public site (en/fa): SSR, hreflang, sitemaps, robots, structured data, legal/trust pages (drafts).
- Security: tenant isolation tests, rate limits, CSP, secret redaction; `@fastify/static` upgraded for advisories.
- Ops: Docker/Compose, encrypted backups with tested restore, systemd timers, CI workflow, license inventory.
