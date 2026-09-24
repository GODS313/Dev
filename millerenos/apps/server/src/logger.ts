import pino from 'pino';

// Paths redacted from every log line. Keep this list in sync with SECURITY.md.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.headers["x-telegram-init-data"]',
  '*.token',
  '*.password',
  '*.secret',
  '*.apiKey',
  '*.initData',
  '*.otp',
  'config.TELEGRAM_BOT_TOKEN',
  'config.ANTHROPIC_API_KEY',
  'config.DATABASE_URL',
  'config.DATABASE_SYSTEM_URL',
];

export function createLogger(level: string) {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'millerenos' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = pino.Logger;

/** Removes bot tokens that might appear inside URLs or error strings. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot[REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]')
    .replace(/postgres(ql)?:\/\/[^@\s]+@/g, 'postgres://[REDACTED]@');
}
