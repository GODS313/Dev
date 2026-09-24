import { useState } from 'preact/hooks';
import { api, type OrderDetail, type OrderRow, type OrderStatus } from '../api';
import { useApp } from '../app';
import { getLocale, t } from '../i18n';
import { formatMoney } from '../money';
import { haptic } from '../tg';
import { Empty, errorMessage, Loadable, StatusBadge, useLoad } from '../ui';

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'paid', 'cancelled'],
  confirmed: ['paid', 'fulfilled', 'cancelled'],
  paid: ['fulfilled', 'refunded'],
  fulfilled: ['refunded'],
  cancelled: [],
  refunded: [],
};
const FILTERS: (OrderStatus | null)[] = [null, 'pending', 'confirmed', 'paid', 'fulfilled', 'cancelled'];

export function Orders() {
  const { ws, go } = useApp();
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const state = useLoad(
    () => api<{ items: OrderRow[] }>('GET', `/workspaces/${ws.workspace.id}/orders${status ? `?status=${status}` : ''}`),
    [status],
  );
  const date = (s: string) =>
    new Date(s).toLocaleString(getLocale() === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <main class="screen">
      <h1>{t('orders.title')}</h1>
      <div class="chips" role="group" aria-label={t('orders.title')}>
        {FILTERS.map((f) => (
          <button key={f ?? 'all'} aria-pressed={status === f} onClick={() => setStatus(f)}>
            {f ? t(`status.${f}`) : t('orders.all')}
          </button>
        ))}
      </div>
      <Loadable state={state}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty text={t('orders.empty')} />
          ) : (
            <ul class="list card">
              {d.items.map((o) => (
                <li key={o.id}>
                  <button class="item" onClick={() => go({ name: 'order', id: o.id })}>
                    <span>
                      <span class="title">{t('orders.number', { number: o.number })}</span> <StatusBadge status={o.status} />
                      <br />
                      <span class="small muted">
                        {o.customer_name ?? '—'} · {date(o.created_at)}
                      </span>
                    </span>
                    <span>{formatMoney(o.total_minor, o.currency, getLocale())}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </main>
  );
}

export function OrderView({ id }: { id: string }) {
  const { ws, refresh } = useApp();
  const wid = ws.workspace.id;
  const state = useLoad(() => api<OrderDetail>('GET', `/workspaces/${wid}/orders/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = (v: string, c: string) => formatMoney(v, c, getLocale());

  async function move(to: OrderStatus) {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/workspaces/${wid}/orders/${id}/status`, { status: to });
      haptic('success');
      state.reload();
      void refresh();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="screen">
      <Loadable state={state}>
        {(o) => (
          <>
            <div class="row between">
              <h1>{t('orders.number', { number: o.number })}</h1>
              <StatusBadge status={o.status} />
            </div>
            <div class="card">
              <p>
                <span class="muted">{t('orders.customer')}: </span>
                {o.customer_name ?? '—'}
              </p>
              {o.customer_note && (
                <p>
                  <span class="muted">{t('orders.note')}: </span>
                  {o.customer_note}
                </p>
              )}
            </div>
            <section class="card" aria-label={t('orders.items')}>
              <ul class="list">
                {o.items.map((i, idx) => (
                  <li key={idx} class="row between" style={{ padding: '10px 0' }}>
                    <span>
                      {i.product_name} × {i.quantity}
                    </span>
                    <span>{m(i.line_total_minor, o.currency)}</span>
                  </li>
                ))}
              </ul>
              <p class="row between" style={{ fontWeight: 700, marginTop: '8px' }}>
                <span>{t('orders.total')}</span>
                <span>{m(o.total_minor, o.currency)}</span>
              </p>
            </section>
            {err && (
              <p class="error" role="alert">
                {err}
              </p>
            )}
            <div class="stack">
              {NEXT[o.status].map((s) => (
                <button
                  key={s}
                  class={s === 'cancelled' || s === 'refunded' ? 'danger block' : 'block'}
                  disabled={busy}
                  onClick={() => move(s)}
                >
                  {t('orders.mark', { status: t(`status.${s}`) })}
                </button>
              ))}
            </div>
          </>
        )}
      </Loadable>
    </main>
  );
}
