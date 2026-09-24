export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
export const setToken = (t: string | null) => (token = t);

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'network');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'internal', data?.error?.message ?? 'error', data?.error?.requestId);
  return data as T;
}

export async function adminApi<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'internal', data?.error?.message ?? 'error');
  return data as T;
}

export const idempotencyKey = () => crypto.randomUUID().replace(/-/g, '');

// ── Shared types (subset of API responses) ─────────────────────────────────
export type Locale = 'en' | 'fa';
export interface Me {
  id: string;
  firstName: string;
  locale: Locale;
  platformRole: 'user' | 'support' | 'admin' | 'superadmin';
}
export interface WorkspaceRef {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'staff';
}
export type Access =
  | { state: 'trial'; secondsLeft: number; trialEndsAt: string; limits: Limits }
  | { state: 'subscribed'; plan: string; periodEnd: string; limits: Limits }
  | { state: 'expired'; limits: Limits };
export interface Limits {
  products: number;
  ai_requests: number;
}
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  currency: string;
  default_locale: Locale;
  ai_mode: 'MANUAL' | 'SUGGEST_ONLY' | 'APPROVAL_REQUIRED' | 'AUTO_ALLOWED';
  business_policies: string;
  store_published: boolean;
  store_settings: { tagline?: string; delivery_info?: string; support_contact?: string };
}
export interface WorkspaceDetail {
  workspace: Workspace;
  role: WorkspaceRef['role'];
  access: Access;
  onboarding: { steps: { key: string; done: boolean }[]; completed: number; total: number };
  usage: { products: number; orders: number };
  storeLink: string | null;
}
export interface Variant {
  id: string;
  name: string;
  price_minor: string;
  stock: number | null;
  sku: string | null;
}
export interface Product {
  id: string;
  name: string;
  description: string;
  kind: 'physical' | 'service' | 'digital';
  status: 'draft' | 'active' | 'archived';
  variants: Variant[];
}
export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  currency: string;
  total_minor: string;
  created_at: string;
  customer_name: string | null;
}
export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
export interface OrderDetail extends OrderRow {
  subtotal_minor: string;
  discount_minor: string;
  customer_note: string;
  items: { product_name: string; variant_name: string; unit_price_minor: string; quantity: number; line_total_minor: string }[];
}
