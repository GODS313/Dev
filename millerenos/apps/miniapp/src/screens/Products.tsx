import { useState } from 'preact/hooks';
import { api, type Product } from '../api';
import { useApp } from '../app';
import { getLocale, num, t, type Key } from '../i18n';
import { formatMoney, parseAmount, toMajorString } from '../money';
import { haptic } from '../tg';
import { Empty, errorMessage, Field, Loadable, toast, useLoad } from '../ui';

export function Products() {
  const { ws, go } = useApp();
  const wid = ws.workspace.id;
  const state = useLoad(() => api<{ items: Product[] }>('GET', `/workspaces/${wid}/products`), [wid]);
  return (
    <main class="screen">
      <div class="row between">
        <h1>{t('products.title')}</h1>
        <button onClick={() => go({ name: 'product' })}>+ {t('products.add')}</button>
      </div>
      <Loadable state={state}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty text={t('products.empty')} action={<button onClick={() => go({ name: 'product' })}>{t('products.add')}</button>} />
          ) : (
            <ul class="list card">
              {d.items.map((p) => {
                const v = p.variants[0];
                return (
                  <li key={p.id}>
                    <button class="item" onClick={() => go({ name: 'product', id: p.id })}>
                      <span>
                        <span class="title">{p.name}</span>
                        <br />
                        <span class="small muted">
                          {t(`products.status.${p.status}` as Key)}
                          {v?.stock !== null && v?.stock !== undefined
                            ? ` · ${v.stock === 0 ? t('products.out_of_stock') : num(v.stock)}`
                            : ''}
                        </span>
                      </span>
                      <span>{v ? formatMoney(v.price_minor, ws.workspace.currency, getLocale()) : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Loadable>
    </main>
  );
}

export function ProductEdit({ id }: { id?: string }) {
  const { ws, back, refresh } = useApp();
  const wid = ws.workspace.id;
  const cur = ws.workspace.currency;
  const state = useLoad(() => (id ? api<Product>('GET', `/workspaces/${wid}/products/${id}`) : Promise.resolve(null)), [id]);
  return (
    <main class="screen">
      <h1>{id ? '' : t('products.add')}</h1>
      <Loadable state={state}>
        {(p) => <ProductForm product={p} wid={wid} currency={cur} onSaved={async () => (await refresh(), back())} />}
      </Loadable>
    </main>
  );
}

function ProductForm({ product, wid, currency, onSaved }: { product: Product | null; wid: string; currency: string; onSaved: () => void }) {
  const v = product?.variants[0];
  const [name, setName] = useState(product?.name ?? '');
  const [price, setPrice] = useState(v ? toMajorString(v.price_minor, currency) : '');
  const [stock, setStock] = useState(v?.stock === null || v?.stock === undefined ? '' : String(v.stock));
  const [description, setDescription] = useState(product?.description ?? '');
  const [kind, setKind] = useState<Product['kind']>(product?.kind ?? 'physical');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: Event) {
    e.preventDefault();
    const priceMinor = parseAmount(price, currency);
    if (priceMinor === null) return setErr(t('products.invalid_price'));
    const stockNum = stock.trim() === '' ? null : parseAmount(stock, 'JPY');
    setBusy(true);
    setErr(null);
    try {
      const body = { name: name.trim(), priceMinor, stock: stockNum, description, kind };
      if (product) await api('PATCH', `/workspaces/${wid}/products/${product.id}`, body);
      else await api('POST', `/workspaces/${wid}/products`, body);
      haptic('success');
      toast(t('app.saved'));
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!product) return;
    setBusy(true);
    try {
      await api('PATCH', `/workspaces/${wid}/products/${product.id}`, { status: 'archived' });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  async function aiDraft() {
    setAiBusy(true);
    setErr(null);
    try {
      const r = await api<{ text: string }>('POST', `/workspaces/${wid}/ai/product-description`, {
        name: name || 'Product',
        notes: description,
        language: getLocale(),
      });
      setDescription(r.text);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <form onSubmit={save} class="card">
      <Field label={t('products.name')} id="pn">
        <input id="pn" required maxLength={120} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </Field>
      <div class="grid2">
        <Field label={t('products.price', { currency })} id="pp">
          <input id="pp" required inputMode="decimal" value={price} onInput={(e) => setPrice(e.currentTarget.value)} />
        </Field>
        <Field label={t('products.kind')} id="pk">
          <select id="pk" value={kind} onChange={(e) => setKind(e.currentTarget.value as Product['kind'])}>
            {(['physical', 'service', 'digital'] as const).map((k) => (
              <option value={k} key={k}>
                {t(`products.kind.${k}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t('products.stock')} id="ps">
        <input id="ps" inputMode="numeric" value={stock} onInput={(e) => setStock(e.currentTarget.value)} />
      </Field>
      <Field label={t('products.description')} id="pd">
        <textarea id="pd" maxLength={4000} value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
      </Field>
      <button type="button" class="secondary" disabled={aiBusy || !name.trim()} onClick={aiDraft}>
        {aiBusy ? t('app.loading') : t('products.ai_draft')}
      </button>
      {err && (
        <p class="error" role="alert">
          {err}
        </p>
      )}
      <div class="row" style={{ marginTop: '14px' }}>
        <button class="block" disabled={busy}>
          {t('app.save')}
        </button>
        {product && product.status !== 'archived' && (
          <button type="button" class="danger" disabled={busy} onClick={archive}>
            {t('products.archive')}
          </button>
        )}
      </div>
    </form>
  );
}
