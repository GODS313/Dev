import { useMemo, useState } from 'preact/hooks';
import { ApiError, api, idempotencyKey } from '../api';
import { getLocale, num, t } from '../i18n';
import { formatMoney } from '../money';
import { haptic } from '../tg';
import { Empty, errorMessage, Field, Loadable, useLoad } from '../ui';

interface StoreData {
  store: { name: string; slug: string; currency: string; tagline: string; deliveryInfo: string; supportContact: string };
  products: {
    id: string;
    name: string;
    description: string;
    variants: { id: string; name: string; price_minor: string; in_stock: boolean }[];
  }[];
}

/** Customer-facing storefront inside the Mini App. */
export function Shop({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  const state = useLoad(() => api<StoreData>('GET', `/store/${slug}`), [slug]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useMemo(() => idempotencyKey(), [done]); // new key per order attempt, stable across retries

  if (state.error instanceof ApiError && state.error.status === 404)
    return (
      <main class="screen">
        <Empty text={t('shop.unavailable')} />
      </main>
    );

  return (
    <main class="screen" style={{ paddingBottom: '160px' }}>
      <Loadable state={state}>
        {(d) => {
          const cur = d.store.currency;
          const variants = new Map(d.products.flatMap((p) => p.variants.map((v) => [v.id, { ...v, product: p.name }] as const)));
          const lines = Object.entries(cart).filter(([, q]) => q > 0);
          const total = lines.reduce((s, [id, q]) => s + Number(variants.get(id)?.price_minor ?? 0) * q, 0);
          const setQty = (id: string, q: number) => setCart({ ...cart, [id]: Math.max(0, Math.min(99, q)) });

          async function checkout() {
            setBusy(true);
            setErr(null);
            try {
              const r = await api<{ order: { number: string } }>('POST', `/store/${slug}/orders`, {
                items: lines.map(([variantId, quantity]) => ({ variantId, quantity })),
                note: note || undefined,
                idempotencyKey: key,
              });
              haptic('success');
              setCart({});
              setDone(r.order.number);
            } catch (e) {
              haptic('error');
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }

          if (done)
            return (
              <div class="card" role="status">
                <h1>{d.store.name}</h1>
                <p>{t('shop.done', { number: num(Number(done)) })}</p>
                {d.store.deliveryInfo && <p class="muted">{d.store.deliveryInfo}</p>}
                {d.store.supportContact && <p class="muted">{d.store.supportContact}</p>}
              </div>
            );

          return (
            <>
              <h1>{d.store.name}</h1>
              {d.store.tagline && <p class="muted">{d.store.tagline}</p>}
              {d.products.length === 0 && <Empty text={t('shop.empty')} />}
              {d.products.map((p) => {
                const v = p.variants[0]!;
                const q = cart[v.id] ?? 0;
                return (
                  <article class="card" key={p.id}>
                    <div class="row between">
                      <h2 style={{ margin: 0 }}>{p.name}</h2>
                      <strong>{formatMoney(v.price_minor, cur, getLocale())}</strong>
                    </div>
                    {p.description && (
                      <p class="muted small" style={{ marginTop: '6px' }}>
                        {p.description}
                      </p>
                    )}
                    {!v.in_stock ? (
                      <span class="badge">—</span>
                    ) : q === 0 ? (
                      <button class="secondary" onClick={() => setQty(v.id, 1)}>
                        {t('shop.add')}
                      </button>
                    ) : (
                      <div class="row" role="group" aria-label={p.name}>
                        <button class="secondary" aria-label="−" onClick={() => setQty(v.id, q - 1)}>
                          −
                        </button>
                        <span aria-live="polite">{num(q)}</span>
                        <button class="secondary" aria-label="+" onClick={() => setQty(v.id, q + 1)}>
                          +
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
              {lines.length > 0 && (
                <div class="sticky-cta">
                  <Field label={t('shop.note')} id="note">
                    <input id="note" maxLength={500} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
                  </Field>
                  {err && (
                    <p class="error" role="alert">
                      {err}
                    </p>
                  )}
                  <button class="block" disabled={busy || !signedIn} onClick={checkout}>
                    {t('shop.checkout')} · {formatMoney(total, cur, getLocale())}
                  </button>
                </div>
              )}
              <p class="small muted" style={{ textAlign: 'center' }}>
                {t('shop.powered')}
              </p>
            </>
          );
        }}
      </Loadable>
    </main>
  );
}
