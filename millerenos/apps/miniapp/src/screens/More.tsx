import { useState } from 'preact/hooks';
import { adminApi, api, type Workspace } from '../api';
import { useApp } from '../app';
import { getLocale, num, t, type Key } from '../i18n';
import { tg, haptic } from '../tg';
import { Empty, errorMessage, Field, Loadable, toast, useLoad } from '../ui';

export function More() {
  const { go, me } = useApp();
  const items: [Key, () => void][] = [
    ['more.store', () => go({ name: 'store' })],
    ['more.customers', () => go({ name: 'customers' })],
    ['more.plans', () => go({ name: 'plans' })],
    ['more.support', () => go({ name: 'support' })],
    ['more.settings', () => go({ name: 'settings' })],
  ];
  if (me.platformRole !== 'user') items.push(['more.admin', () => go({ name: 'admin' })]);
  return (
    <main class="screen">
      <h1>{t('more.title')}</h1>
      <ul class="list card">
        {items.map(([k, fn]) => (
          <li key={k}>
            <button class="item" onClick={fn}>
              <span class="title">{t(k)}</span>
              <span aria-hidden="true">{getLocale() === 'fa' ? '‹' : '›'}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function StoreSettings() {
  const { ws, refresh } = useApp();
  const w = ws.workspace;
  const [f, setF] = useState({
    name: w.name,
    tagline: w.store_settings.tagline ?? '',
    delivery_info: w.store_settings.delivery_info ?? '',
    support_contact: w.store_settings.support_contact ?? '',
    currency: w.currency,
    store_published: w.store_published,
    business_policies: w.business_policies,
    ai_mode: w.ai_mode,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const canEdit = ws.role !== 'staff';

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name: f.name,
        store_published: f.store_published,
        business_policies: f.business_policies,
        ai_mode: f.ai_mode,
        store_settings: { tagline: f.tagline, delivery_info: f.delivery_info, support_contact: f.support_contact },
      };
      if (f.currency !== w.currency) body.currency = f.currency;
      await api('PATCH', `/workspaces/${w.id}`, body);
      await refresh();
      haptic('success');
      toast(t('app.saved'));
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="screen">
      <h1>{t('store.title')}</h1>
      <form class="card" onSubmit={save}>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <label class="check">
            <input type="checkbox" checked={f.store_published} onChange={(e) => set('store_published', e.currentTarget.checked)} />
            {t('store.published')}
          </label>
          <Field label={t('store.name')} id="sn">
            <input id="sn" required maxLength={80} value={f.name} onInput={(e) => set('name', e.currentTarget.value)} />
          </Field>
          <Field label={t('store.tagline')} id="st">
            <input id="st" maxLength={160} value={f.tagline} onInput={(e) => set('tagline', e.currentTarget.value)} />
          </Field>
          <Field label={t('store.delivery')} id="sd">
            <textarea id="sd" maxLength={500} value={f.delivery_info} onInput={(e) => set('delivery_info', e.currentTarget.value)} />
          </Field>
          <Field label={t('store.contact')} id="sc">
            <input id="sc" maxLength={120} value={f.support_contact} onInput={(e) => set('support_contact', e.currentTarget.value)} />
          </Field>
          <Field label={t('store.currency')} id="scu">
            <select id="scu" value={f.currency} onChange={(e) => set('currency', e.currentTarget.value)}>
              {['USD', 'EUR', 'GBP', 'TRY', 'AED', 'IRR', 'IRT'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('store.policies')} id="sp">
            <textarea
              id="sp"
              maxLength={4000}
              value={f.business_policies}
              onInput={(e) => set('business_policies', e.currentTarget.value)}
            />
          </Field>
          <Field label={t('store.ai_mode')} id="sai">
            <select id="sai" value={f.ai_mode} onChange={(e) => set('ai_mode', e.currentTarget.value as Workspace['ai_mode'])}>
              {(['MANUAL', 'SUGGEST_ONLY', 'APPROVAL_REQUIRED'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`store.ai_mode.${m}`)}
                </option>
              ))}
            </select>
          </Field>
          {err && (
            <p class="error" role="alert">
              {err}
            </p>
          )}
          <button class="block" disabled={busy}>
            {t('app.save')}
          </button>
        </fieldset>
      </form>
      <Faq />
    </main>
  );
}

function Faq() {
  const { ws } = useApp();
  const wid = ws.workspace.id;
  const state = useLoad(() => api<{ items: { id: string; question: string; answer: string }[] }>('GET', `/workspaces/${wid}/faq`), [wid]);
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function add(e: Event) {
    e.preventDefault();
    try {
      await api('POST', `/workspaces/${wid}/faq`, { question: q, answer: a });
      setQ('');
      setA('');
      state.reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  async function remove(id: string) {
    await api('DELETE', `/workspaces/${wid}/faq/${id}`).catch((e2) => setErr(errorMessage(e2)));
    state.reload();
  }
  return (
    <section class="card">
      <h2>{t('store.faq')}</h2>
      <Loadable state={state} skeletons={1}>
        {(d) => (
          <ul class="list">
            {d.items.map((x) => (
              <li key={x.id} class="row between" style={{ padding: '8px 0' }}>
                <span>
                  <strong>{x.question}</strong>
                  <br />
                  <span class="small muted">{x.answer}</span>
                </span>
                <button class="ghost" aria-label="×" onClick={() => remove(x.id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <form onSubmit={add}>
        <Field label={t('store.faq_q')} id="fq">
          <input id="fq" required maxLength={500} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </Field>
        <Field label={t('store.faq_a')} id="fa">
          <textarea id="fa" required maxLength={2000} value={a} onInput={(e) => setA(e.currentTarget.value)} />
        </Field>
        {err && <p class="error">{err}</p>}
        <button class="secondary">{t('store.faq_add')}</button>
      </form>
    </section>
  );
}

export function Customers() {
  const { ws } = useApp();
  const state = useLoad(() =>
    api<{ items: { id: string; display_name: string; orders_count: number }[] }>('GET', `/workspaces/${ws.workspace.id}/customers`),
  );
  return (
    <main class="screen">
      <h1>{t('customers.title')}</h1>
      <Loadable state={state}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty text={t('customers.empty')} />
          ) : (
            <ul class="list card">
              {d.items.map((c) => (
                <li key={c.id} class="item">
                  <span class="title">{c.display_name || '—'}</span>
                  <span class="muted small">{t('customers.orders', { n: num(c.orders_count) })}</span>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </main>
  );
}

interface Plan {
  code: string;
  price_stars: number;
  period_days: number;
  limits: { products?: number; ai_requests_per_day?: number };
}

export function Plans() {
  const { ws, refresh } = useApp();
  const state = useLoad(() => api<{ items: Plan[] }>('GET', '/plans'));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const a = ws.access;
  const stateLabel = a.state === 'subscribed' ? a.plan : t(a.state === 'trial' ? 'plans.state_trial' : 'plans.state_expired');

  async function buy(code: string) {
    setBusy(code);
    setErr(null);
    try {
      const r = await api<{ link: string }>('POST', `/workspaces/${ws.workspace.id}/billing/checkout`, { plan: code });
      if (tg) {
        tg.openInvoice(r.link, async (status) => {
          if (status === 'paid') {
            haptic('success');
            toast(t('plans.paid'));
            // the payment is applied when the bot receives successful_payment; poll briefly
            for (let i = 0; i < 5; i++) {
              await new Promise((res) => setTimeout(res, 1500));
              await refresh();
            }
          }
          setBusy(null);
        });
      } else {
        window.open(r.link, '_blank', 'noopener');
        setBusy(null);
      }
    } catch (e2) {
      setErr(errorMessage(e2));
      setBusy(null);
    }
  }

  return (
    <main class="screen">
      <h1>{t('plans.title')}</h1>
      <p class="muted">{t('plans.current', { state: stateLabel })}</p>
      {err && (
        <p class="error" role="alert">
          {err}
        </p>
      )}
      <Loadable state={state}>
        {(d) => (
          <>
            {d.items.map((p) => (
              <section class="card" key={p.code}>
                <div class="row between">
                  <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{p.code}</h2>
                  <span class="stat">{num(p.price_stars)} ⭐</span>
                </div>
                <p class="muted small">
                  {t('plans.period', { days: num(p.period_days) })} ·{' '}
                  {t('plans.limits', { products: num(p.limits.products ?? 0), ai: num(p.limits.ai_requests_per_day ?? 0) })}
                </p>
                <button class="block" disabled={busy !== null || ws.role === 'staff'} onClick={() => buy(p.code)}>
                  {busy === p.code ? t('app.loading') : t('plans.buy', { price: num(p.price_stars) })}
                </button>
              </section>
            ))}
            <p class="small muted">{t('plans.note')}</p>
          </>
        )}
      </Loadable>
    </main>
  );
}

export function Settings() {
  const { me, changeLocale } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);

  async function exportData() {
    try {
      const data = await api('GET', '/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'millerenos-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }
  async function requestDeletion() {
    if (!confirm(t('settings.delete_confirm'))) return;
    try {
      const r = await api<{ executeAfter: string }>('POST', '/account/deletion');
      setScheduled(new Date(r.executeAfter).toLocaleDateString(getLocale() === 'fa' ? 'fa-IR' : 'en-GB'));
    } catch (e) {
      setErr(errorMessage(e));
    }
  }
  async function cancelDeletion() {
    try {
      await api('DELETE', '/account/deletion');
      setScheduled(null);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <main class="screen">
      <h1>{t('settings.title')}</h1>
      <section class="card">
        <Field label={t('settings.language')} id="lang">
          <select id="lang" value={me.locale} onChange={(e) => changeLocale(e.currentTarget.value as 'en' | 'fa')}>
            <option value="en">English</option>
            <option value="fa">فارسی</option>
          </select>
        </Field>
      </section>
      <section class="card stack">
        <button class="secondary block" onClick={exportData}>
          {t('settings.export')}
        </button>
        <a
          class="btn secondary"
          href={`/${me.locale}/privacy`}
          target="_blank"
          rel="noopener"
          style={{ width: '100%', background: 'var(--surface)', color: 'var(--text)' }}
        >
          {t('settings.privacy')}
        </a>
        {scheduled ? (
          <>
            <p>{t('settings.delete_scheduled', { date: scheduled })}</p>
            <button class="secondary block" onClick={cancelDeletion}>
              {t('settings.delete_cancel')}
            </button>
          </>
        ) : (
          <button class="danger block" onClick={requestDeletion}>
            {t('settings.delete')}
          </button>
        )}
        {err && <p class="error">{err}</p>}
      </section>
    </main>
  );
}

export function Admin() {
  const overview = useLoad(() =>
    adminApi<{ counts: Record<string, number | string>; funnel7d: Record<string, number> }>('GET', '/overview'),
  );
  const health = useLoad(() =>
    adminApi<{
      db: { latencyMs: number };
      jobs: { stats: Record<string, number> };
      integrations: Record<string, unknown>;
      backups: { kind: string; status: string; created_at: string }[];
    }>('GET', '/health'),
  );
  const tickets = useLoad(() =>
    adminApi<{ items: { id: string; reference: string; subject: string; status: string }[] }>('GET', '/support'),
  );
  return (
    <main class="screen">
      <h1>{t('admin.title')}</h1>
      <Loadable state={overview}>
        {(d) => (
          <div class="grid2 wide">
            {Object.entries(d.counts).map(([k, v]) => (
              <div class="card" key={k}>
                <div class="stat">{String(v)}</div>
                <div class="small muted">{k.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        )}
      </Loadable>
      <h2>{t('admin.funnel')}</h2>
      <Loadable state={overview} skeletons={1}>
        {(d) => (
          <ul class="list card">
            {Object.entries(d.funnel7d).map(([k, v]) => (
              <li key={k} class="row between" style={{ padding: '6px 0' }}>
                <span>{k}</span>
                <strong>{v}</strong>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <h2>{t('admin.health')}</h2>
      <Loadable state={health} skeletons={1}>
        {(h) => (
          <div class="card small">
            <p>DB latency: {h.db.latencyMs} ms</p>
            <p>Jobs: {JSON.stringify(h.jobs.stats)}</p>
            <p>Integrations: {JSON.stringify(h.integrations)}</p>
            <p>Last backup: {h.backups[0] ? `${h.backups[0].kind} ${h.backups[0].status} ${h.backups[0].created_at}` : '—'}</p>
          </div>
        )}
      </Loadable>
      <h2>{t('admin.tickets')}</h2>
      <Loadable state={tickets} skeletons={1}>
        {(d) => (
          <ul class="list card">
            {d.items.map((x) => (
              <li key={x.id} class="row between" style={{ padding: '6px 0' }}>
                <span>
                  {x.reference} · {x.subject}
                </span>
                <span class="badge">{x.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Loadable>
    </main>
  );
}
