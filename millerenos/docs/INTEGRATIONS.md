# Integrations

Source of truth in code: `modules/channels/registry.ts`, `modules/billing/providers.ts`, `modules/domains/providers.ts`,
exposed at `GET /api/v1/integrations` and on the public `/en/integrations` page (a test fails if an unavailable
connector is ever shown as supported).

Status meanings: **OFFICIAL_SUPPORTED** (official method, implemented, tested) · **LIMITED_SUPPORTED** (works with
documented limits) · **EXPERIMENTAL** (behind a flag, selected workspaces only) · **UNAVAILABLE** (not implemented).

## Messaging channels
| Platform | Status | Method | Notes |
|---|---|---|---|
| Telegram | OFFICIAL_SUPPORTED | Bot API + Mini Apps | Millerenos bot, storefront Mini App |
| Bale | UNAVAILABLE | Bale Bot API (to evaluate) | review terms/stability first; flag `channels.bale` |
| Eitaa | UNAVAILABLE | Eitaayar (to evaluate) | two-way merchant messaging not confirmed |
| Rubika | UNAVAILABLE | to evaluate | official docs/terms review needed |
| Soroush+ | UNAVAILABLE | unknown | no reviewed official API |
| WhatsApp | UNAVAILABLE | WhatsApp Business Platform (Cloud API) | only the official API will ever be used; needs Meta business verification |

Adapter contract (`ChannelConnector`): `sendMessage(externalChatId, text)`; Phase 2 adds inbound webhooks →
`conversations/messages`, consent checks, per-channel rate limits with backoff, and clear error surfacing.
Unofficial/self-bot clients, session hijacking or anything that violates a platform's terms will not be built.

## Payments
| Provider | Status | Used for |
|---|---|---|
| Telegram Stars (XTR) | OFFICIAL_SUPPORTED | Millerenos plans (digital service sold inside Telegram — Stars required by Telegram rules) |
| Manual transfer | LIMITED_SUPPORTED | Merchant's own orders; merchant marks orders paid; Millerenos handles no money and no card data |

Selection rule (`selectProvider`): subscription + Telegram → Stars; merchant order → manual. Card gateways
(merchant-specific PSPs, Stripe where lawful) plug in behind the same interface later with signed-webhook
verification and idempotency, gated by a feature flag and legal review per jurisdiction.

Stars flow: `createInvoiceLink` (XTR, empty provider token) → Mini App `openInvoice` or bot URL button →
`pre_checkout_query` re-validation → `successful_payment` recorded once → subscription activated/extended.
Refunds: admin → `refundStarPayment`.

## AI
Provider interface `AiProvider`. Implemented: Anthropic (`AI_PROVIDER=anthropic`, model `AI_MODEL`, default
`claude-opus-5`, `AI_EFFORT=low`; server-side refusal fallback enabled). `disabled` when no key → features report
"not configured". Cost control: per-plan/trial quotas in `usage_counters`; token usage stored per request.

## Domains & hosting (Phase 2)
Interfaces `DomainProvider` / `HostingProvider` exist; **no provider is connected** and the marketplace flag is off.
Needed from the founder: provider name, confirmation of an official reseller API, API credentials (stored only in
server secrets), and pricing/markup decisions.
