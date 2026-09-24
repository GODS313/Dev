-- Multi-currency plan prices (Telegram Stars + TRON network: USDT TRC-20 and TRX) and on-chain invoices.
-- Crypto checkout happens on the website, never inside the bot / Mini App (Telegram requires Stars there).

ALTER TABLE plans
  ADD COLUMN price_usdt_micro bigint CHECK (price_usdt_micro > 0),  -- USDT has 6 decimals: 5 USDT = 5000000
  ADD COLUMN price_trx_sun    bigint CHECK (price_trx_sun > 0);     -- 1 TRX = 1,000,000 sun

-- PLACEHOLDER prices — founder must confirm (docs/FOUNDER_GUIDE.fa.md). Editable via PATCH /api/admin/plans/:code.
UPDATE plans SET price_usdt_micro = 5000000,  price_trx_sun = 17000000 WHERE code = 'starter';
UPDATE plans SET price_usdt_micro = 15000000, price_trx_sun = 50000000 WHERE code = 'growth';

ALTER TABLE invoices DROP CONSTRAINT invoices_provider_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_provider_check
  CHECK (provider IN ('telegram_stars', 'manual_transfer', 'tron_usdt', 'tron_trx'));
-- Crypto tickers can be longer than ISO-4217 codes (USDT).
ALTER TABLE invoices DROP CONSTRAINT invoices_currency_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_check CHECK (currency ~ '^[A-Z]{3,5}$');
ALTER TABLE invoices ADD COLUMN pay_to text CHECK (pay_to ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$');

-- Crypto transfers carry no memo, so each open invoice gets a unique exact amount (base price + tiny offset).
CREATE UNIQUE INDEX invoices_open_crypto_amount ON invoices (provider, amount_minor)
  WHERE status = 'open' AND provider IN ('tron_usdt', 'tron_trx');
CREATE INDEX invoices_crypto_recent ON invoices (provider, created_at DESC) WHERE provider IN ('tron_usdt', 'tron_trx');

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('payments.tron', true, 'USDT (TRC-20) / TRX checkout on the website (requires TRON_RECEIVE_ADDRESS)');
