# Divar Hamkare Agent Skill

## Goal
Manage inbound recruitment chats on the owner's Divar posts with minimal manual work, using the official Kenar Divar API.

## Rules
1. Process only inbound `BUYER` messages in `POST` conversations.
2. Process only explicitly allowed post tokens unless `ALLOW_ALL_POSTS=true` is intentionally enabled.
3. Send at most one automatic first reply per conversation.
4. Never scrape or infer phone numbers. Store contact details only when Divar actually delivers a `CONTACT` payload or another officially authorized field.
5. Relay each new inbound message to the configured Telegram admin chat.
6. Allow manual replies from Telegram only when the sender is the configured admin chat.
7. Keep response templates centrally stored in SQLite and seed them from `templates.json`.
8. Do not use replies for unrelated advertising or unsolicited outreach. The response must be relevant to the recruitment conversation that the user initiated.
9. Persist message IDs and conversation state so restarts cannot cause duplicate automatic replies.
10. Keep API keys, OAuth credentials, Telegram token and identification key out of Git and in a root-readable env file.

## Telegram commands
- `/status` or `/stats`
- `/on`
- `/off`
- `/templates`
- `/use NAME`
- `/set NAME | TEXT`
- `/reply CONVERSATION_ID | TEXT`

## Divar integration
Webhook endpoint: `/webhook/divar`
Health endpoint: `/health`

The service expects Divar's webhook `Authorization` header to exactly match `DIVAR_IDENTIFICATION_KEY`.
