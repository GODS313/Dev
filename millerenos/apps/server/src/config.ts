import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: z.url().default('http://localhost:8080'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: bool.default(false),

  DATABASE_URL: z.string().min(1), // role millerenos_app (RLS enforced)
  DATABASE_SYSTEM_URL: z.string().min(1), // role millerenos_system (cross-tenant, internal use only)
  DATABASE_MIGRATION_URL: z.string().optional(), // role millerenos_owner
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .regex(/^[A-Za-z0-9_]{5,32}$/)
    .optional(),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/)
    .optional(),
  // Comma-separated numeric Telegram IDs that are promoted to superadmin on first contact.
  PLATFORM_ADMIN_TELEGRAM_IDS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          if (!/^\d{1,20}$/.test(x)) throw new Error('PLATFORM_ADMIN_TELEGRAM_IDS must be numeric ids');
          return BigInt(x);
        }),
    ),

  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),

  TRIAL_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  TRIAL_AI_REQUESTS: z.coerce.number().int().min(0).max(1000).default(20),
  TRIAL_MAX_PRODUCTS: z.coerce.number().int().min(1).max(1000).default(25),
  TRIAL_MAX_ORDERS: z.coerce.number().int().min(1).max(10000).default(50),

  AI_PROVIDER: z.enum(['anthropic', 'disabled']).default('disabled'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),

  // Secret for keyed hashes of identifiers (e.g. trial claims). Required in production.
  DATA_HASH_SECRET: z.string().min(32).default('dev-only-data-hash-secret-change-me-000'),

  // TRON network payments (USDT TRC-20 / TRX). Receive-only address; the server never holds private keys.
  TRON_RECEIVE_ADDRESS: z
    .string()
    .regex(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)
    .optional(),
  TRON_API_BASE: z
    .url()
    .refine((u) => u.startsWith('https://'), 'must be https')
    .default('https://api.trongrid.io'),
  TRONGRID_API_KEY: z.string().optional(),
  CRYPTO_INVOICE_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .default(120),
  SECURITY_CONTACT: z.string().max(200).optional(),

  METRICS_TOKEN: z.string().min(16).optional(),
});

export type Config = z.infer<typeof schema>;

/** Path prefix the app is served under, from PUBLIC_BASE_URL (e.g. https://example.com/God → "/God"). */
export function basePath(cfg: Pick<Config, 'PUBLIC_BASE_URL'>): string {
  return new URL(cfg.PUBLIC_BASE_URL).pathname.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Only field names and messages are printed — never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  const bp = basePath(cfg);
  if (bp && !/^(\/[A-Za-z0-9_-]+)+$/.test(bp)) throw new Error('Invalid configuration: PUBLIC_BASE_URL path must be like /God');
  if (cfg.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!cfg.PUBLIC_BASE_URL.startsWith('https://')) missing.push('PUBLIC_BASE_URL must be https');
    if (cfg.DATA_HASH_SECRET.startsWith('dev-only')) missing.push('DATA_HASH_SECRET');
    if (cfg.TELEGRAM_BOT_TOKEN && !cfg.TELEGRAM_WEBHOOK_SECRET) missing.push('TELEGRAM_WEBHOOK_SECRET');
    if (cfg.AI_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
    if (missing.length) throw new Error(`Invalid production configuration: ${missing.join(', ')}`);
  }
  return cfg;
}
