# API (v1)

Base: `/api/v1`. JSON only. Auth: `Authorization: Bearer <session token>` from `POST /auth/telegram`.
Errors: `{ "error": { "code", "message", "details?", "requestId" } }`. Codes: `bad_request 400, unauthorized 401,
access_expired 402, forbidden 403, not_found 404, conflict 409, validation_failed 422, rate_limited 429,
quota_exceeded 429, not_configured 503, ai_error 502, internal 500`. Every response carries `x-request-id`.
Pagination: `?limit=&cursor=` (cursor = `created_at` of the last item; response has `nextCursor`).
Idempotency: order creation requires `idempotencyKey` (8–128 chars `[A-Za-z0-9_-]`).
Money: integer minor units as strings in responses (`"1250"` = 12.50 USD).

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/telegram` | – | `{initData}` → `{token, expiresAt, user, workspaces}`; 20/min/IP |
| POST | `/auth/logout` | user | revokes session |
| GET/PATCH | `/me` | user | PATCH `{locale}` |
| POST | `/trial` | user | `{businessName?}`; 409 if already used |
| GET | `/workspaces/:wid` | staff | workspace, role, access (trial countdown), onboarding, usage, storeLink |
| PATCH | `/workspaces/:wid` | admin | name, currency (before first order), ai_mode, business_policies, store_published, store_settings |
| GET/POST | `/workspaces/:wid/categories` | staff/admin | |
| GET/POST | `/workspaces/:wid/products` | staff | quota-checked |
| GET/PATCH | `/workspaces/:wid/products/:pid` | staff | archive = `{status:"archived"}` |
| GET | `/workspaces/:wid/orders` | staff | `?status=` |
| GET | `/workspaces/:wid/orders/:oid` | staff | |
| POST | `/workspaces/:wid/orders/:oid/status` | staff | state machine enforced |
| GET | `/workspaces/:wid/customers` | staff | `?q=` |
| GET/POST/DELETE | `/workspaces/:wid/faq[/:fid]` | staff/admin | AI grounding |
| POST | `/workspaces/:wid/ai/reply-suggestion` | staff | `{customerMessage}` |
| POST | `/workspaces/:wid/ai/product-description` | staff | `{name, notes, language}` |
| POST | `/workspaces/:wid/ai/suggestions/:sid/review` | admin | `{decision}` |
| GET | `/plans` | – | plans + payment provider statuses |
| GET | `/workspaces/:wid/billing` | admin | subscription, invoices, access |
| POST | `/workspaces/:wid/billing/checkout` | admin | `{plan}` → `{invoiceId, link}` (Telegram Stars) |
| GET | `/store/:slug` | – | public store + catalog (published & active only) |
| POST | `/store/:slug/orders` | user | customer order |
| GET/POST | `/support/tickets` | user | |
| GET | `/support/tickets/:id` · POST `/messages` | owner | |
| GET | `/account/export` | user | personal data JSON |
| POST/DELETE | `/account/deletion` | user | schedule (14-day grace) / cancel |
| GET | `/integrations` | – | honest integration status |

Admin API (`/api/admin/*`, platform roles only, 404 otherwise): `overview, health, users, users/:id/block,
users/:id/role (superadmin), workspaces, workspaces/:id/status, payments, payments/:id/refund (superadmin),
flags, flags/:key (superadmin), audit, ai-usage, support, support/:id, support/:id/reply`.

Other endpoints: `POST /tg/webhook` (Telegram, secret header), `GET /healthz`, `GET /readyz`, `GET /metrics` (bearer `METRICS_TOKEN`).

The API is not public for third parties yet; an OpenAPI document and API keys are Phase 2 (BACKLOG.md).
