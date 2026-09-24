# Analytics

First-party, privacy-aware events in `analytics_events` (allow-list in `modules/analytics/track.ts`; unknown names throw).
Props: ≤12 primitive values, keys `[a-z_]`, strings ≤64 chars. No message text or personal data.

| Funnel step | Event | Emitted by |
|---|---|---|
| Discovery → Telegram | `bot_started {source}` (`src_web_<page>`, `src_<campaign>`, `referral`, `direct`) | bot |
| Language | `language_selected {locale}` | bot |
| Trial | `trial_started`, `trial_activated {via}`, `trial_expired` | trial service, worker |
| Mini App | `miniapp_opened {has_workspace}` | auth |
| Activation | `store_created`, `product_created`, `store_published`, `first_order`, `order_created` | API |
| Revenue | `checkout_started {plan}`, `payment_completed`, `subscription_started`, `subscription_renewed`, `subscription_cancelled` | billing |
| Growth | `referral_created`, `referral_signup` | bot |
| Other | `ai_suggestion_generated {feature}`, `support_ticket_created {category}` | API |
| Reserved (Phase 2) | `channel_connected`, `first_customer_message` | connectors |

Admin dashboard shows 7-day distinct counts per event. Key ratios to watch: bot_started → trial_started,
trial_started → product_created → store_published → first_order (time to first value), trial → payment_completed.
