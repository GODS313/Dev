# Backlog

Every item answers at least one of: acquire, activate, make/save money, retain, trust, defensibility, international.

## Phase 1 (MVP) — status
| # | Item | Status |
|---|---|---|
| 1 | Core backend, modular monolith, migrations, RLS | ✅ done, tested |
| 2 | Telegram bot (menus, deep links, language, payments) | ✅ done, tested with simulated updates |
| 3 | Mini App (merchant workspace + customer storefront, en/fa, RTL, themes) | ✅ done, driven end-to-end in Chromium |
| 4 | Auth (init-data) & workspaces (roles) | ✅ |
| 5 | 1-hour trial (server timer, quotas, anti-abuse, read-only after expiry) | ✅ |
| 6 | Plans & subscriptions | ✅ (prices are placeholders — founder decision) |
| 7–8 | Commerce: products, orders, customers, coupons (API), stock | ✅ (coupon management UI: pending) |
| 9 | AI assistant (grounded replies, descriptions, modes, audit) | ✅ code; needs API key to go live |
| 10 | Payment-compliant purchase (Stars) | ✅; must be verified in Telegram test environment with a real bot |
| 11 | Secure admin (API + dashboard) | ✅ basic dashboard; user/workspace management UI pending (API exists) |
| 12 | Public SEO foundation (en/fa) | ✅ |
| 13 | Analytics | ✅ |
| 14 | Backups & monitoring | ✅ scripts tested; needs server + off-site storage |
| 15 | Deployment | ⏳ blocked on server, domain, bot token (founder) |

## Before public launch (next)
1. Production infrastructure (server, domain, TLS, bot) — founder inputs required.
2. Staging bot + Telegram test-environment Stars payment verification.
3. Legal review of privacy/terms texts; set `SECURITY_CONTACT`.
4. Retention purge jobs (AI outputs 180 d, analytics 13 mo, deleted workspaces).
5. Coupon management and category UI in Mini App; product images (safe upload pipeline).
6. Error tracking (e.g. self-hosted GlitchTip/Sentry) and uptime monitor; alerting on failed jobs/backups.
7. Merchant notification preferences; order notification to customer on status change (transactional consent).
8. External penetration test; Dependabot/Renovate.
9. Redis-backed rate limiting before running >1 app replica.

## Phase 2 (after MVP validation, by customer demand)
Customer Telegram store builder (merchant-owned bots), unified inbox (`conversations/messages`) + CRM (leads, tags,
notes), compliant connectors (evaluate Bale first), campaigns with consent/suppression/frequency caps/quiet hours,
domain & hosting provider integration, advanced AI (FAQ auto-answer with approval, summaries), affiliate program,
web storefront (SSR, SEO), public API with OpenAPI + API keys + webhooks, advanced analytics, internal search.
