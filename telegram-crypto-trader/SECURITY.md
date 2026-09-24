# Security policy

## Required invariants

- `TRADING_MODE` remains `paper` until a separately reviewed exchange adapter is added.
- Telegram webhooks pass `X-Telegram-Bot-Api-Secret-Token` validation.
- Only chat IDs in `TELEGRAM_ALLOWED_CHAT_IDS` may execute commands.
- Bot, Slack, and future exchange credentials are runtime secrets and never committed.
- Telegram update IDs are deduplicated before command execution.
- Trade size cannot exceed the account risk limit or available paper balance.
- The emergency pause blocks every new trade.
- Every state-changing command for one chat is serialized before checking balances, risk, holdings, or pause state.

## Out of scope for version 0.1

- Real-money orders, deposits, withdrawals, leverage, futures, or custody.
- Profit guarantees, investment advice, or autonomous strategy execution.

Report suspected vulnerabilities privately to the repository owner. Do not include credentials or user data in an issue.
