/**
 * Provider-independent domain & hosting marketplace interfaces (Phase 2).
 * No provider is configured; the marketplace is behind the `domains.marketplace` flag (off).
 * Credentials for a provider will live only in server-side secrets.
 */
export interface DomainQuote {
  domain: string;
  available: boolean;
  currency: string;
  registerPriceMinor: bigint;
  renewPriceMinor: bigint;
}

export interface DomainProvider {
  readonly id: string;
  search(name: string, tlds: string[]): Promise<DomainQuote[]>;
  register(domain: string, years: number, contactRef: string, idempotencyKey: string): Promise<{ orderRef: string }>;
  renew(domain: string, years: number, idempotencyKey: string): Promise<{ orderRef: string }>;
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
  listDnsRecords(domain: string): Promise<{ type: string; name: string; value: string; ttl: number }[]>;
  upsertDnsRecord(domain: string, rec: { type: string; name: string; value: string; ttl: number }): Promise<void>;
}

export interface HostingProvider {
  readonly id: string;
  listPlans(): Promise<{ code: string; name: string; priceMinor: bigint; currency: string }[]>;
  provision(planCode: string, domain: string, idempotencyKey: string): Promise<{ accountRef: string }>;
  requestSsl(domain: string): Promise<void>;
}

export const DOMAIN_PROVIDERS: { id: string; status: 'UNAVAILABLE'; notes: string }[] = [
  { id: 'founder_hosting_provider', status: 'UNAVAILABLE', notes: 'Waiting for provider name and official reseller API credentials.' },
];

/** Strict hostname validation used before any provider call (SSRF / injection guard). */
export function isValidDomainLabel(label: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label);
}
