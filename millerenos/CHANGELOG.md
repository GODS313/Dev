# Changelog

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
