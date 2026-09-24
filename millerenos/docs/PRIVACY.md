# Privacy engineering notes

Public policy text: `/en/privacy`, `/fa/privacy` (marked **draft — pending legal review**). Do not claim compliance
with any specific regulation (e.g. "100% GDPR compliant") until reviewed by counsel.

## Data inventory
| Data | Where | Purpose | Retention |
|---|---|---|---|
| Telegram id, first name, username, language | `users` | account | until deletion (+14-day grace), then anonymized |
| Session token hash | `sessions` | auth | expiry + 7 days |
| HMAC of Telegram id | `trial_claims` | one trial per person | indefinitely (pseudonymous, no other data) |
| Business data | tenant tables | service | while workspace exists; deleted workspaces purged after retention (BACKLOG) |
| Customer Telegram id + display name | `customers` | merchant's orders | controlled by merchant (merchant is controller, Millerenos processor) |
| AI inputs/outputs | `ai_requests.output_text` (input stored as length only) | audit, approval | 180 days (purge job: BACKLOG) |
| Analytics events | `analytics_events` (allow-listed names, primitive props, no message text) | funnel | 13 months (purge job: BACKLOG) |
| Payment records | `invoices`, `payments`, `refunds` | accounting | as legally required; unlinked from personal data on deletion |
| Audit log | `audit_logs` | security | 2 years |

## Workflows
- **Export**: `GET /api/v1/account/export` (Mini App → Account & privacy → Download my data).
- **Deletion**: `POST /api/v1/account/deletion` → 14-day grace → worker anonymizes user, revokes sessions, marks owned workspaces deleted.
- **Consent (campaigns, Phase 2)**: `consents` table per customer/channel/purpose; no marketing message without `opted_in`; opt-out is immediate and permanent until re-opt-in.

## Processors / subprocessors
Telegram (messaging, Mini App, Stars), AI provider (Anthropic) when AI is used, hosting provider, backup storage provider.
Keep this list and the public page in sync before launch.

## Telemetry rules
Never log or send to analytics: message bodies, names, phone numbers, tokens, init data, payment secrets.
