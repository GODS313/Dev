-- Groups/channels as campaign targets, bot usernames for join links, business auto-replies.
ALTER TABLE identities ADD COLUMN kind TEXT NOT NULL DEFAULT 'private';
ALTER TABLE identities ADD COLUMN title TEXT;
ALTER TABLE connectors ADD COLUMN bot_username TEXT;
ALTER TABLE connectors ADD COLUMN business_reply TEXT;
ALTER TABLE campaigns ADD COLUMN audience TEXT NOT NULL DEFAULT 'subscribers';

-- One auto-reply per customer chat per day, so a connected account never floods anyone.
CREATE TABLE IF NOT EXISTS business_replies (
    connector_id INTEGER NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    replied_on TEXT NOT NULL,
    PRIMARY KEY (connector_id, chat_id)
);
