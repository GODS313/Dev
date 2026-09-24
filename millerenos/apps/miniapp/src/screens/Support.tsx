import { useState } from 'preact/hooks';
import { api } from '../api';
import { useApp } from '../app';
import { getLocale, t } from '../i18n';
import { Empty, errorMessage, Field, Loadable, useLoad } from '../ui';

interface Ticket {
  id: string;
  reference: string;
  status: string;
  subject: string;
  created_at: string;
}

export function Support() {
  const { go, ws } = useApp();
  const list = useLoad(() => api<{ items: Ticket[] }>('GET', '/support/tickets'));
  const [category, setCategory] = useState<'technical' | 'payment' | 'account' | 'other'>('technical');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<Ticket>('POST', '/support/tickets', { category, subject, body, workspaceId: ws.workspace.id });
      setMsg(t('support.created', { ref: r.reference }));
      setSubject('');
      setBody('');
      list.reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="screen">
      <h1>{t('support.title')}</h1>
      <form class="card" onSubmit={create}>
        <h2>{t('support.new')}</h2>
        <Field label={t('support.category')} id="tc">
          <select id="tc" value={category} onChange={(e) => setCategory(e.currentTarget.value as typeof category)}>
            {(['technical', 'payment', 'account', 'other'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`support.cat.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('support.subject')} id="ts">
          <input id="ts" required maxLength={160} value={subject} onInput={(e) => setSubject(e.currentTarget.value)} />
        </Field>
        <Field label={t('support.body')} id="tb">
          <textarea id="tb" required maxLength={4000} value={body} onInput={(e) => setBody(e.currentTarget.value)} />
        </Field>
        {err && (
          <p class="error" role="alert">
            {err}
          </p>
        )}
        {msg && <p role="status">{msg}</p>}
        <button class="block" disabled={busy}>
          {t('support.send')}
        </button>
      </form>
      <Loadable state={list}>
        {(d) =>
          d.items.length === 0 ? (
            <Empty text={t('support.empty')} />
          ) : (
            <ul class="list card">
              {d.items.map((x) => (
                <li key={x.id}>
                  <button class="item" onClick={() => go({ name: 'ticket', id: x.id })}>
                    <span>
                      <span class="title">{x.reference}</span>
                      <br />
                      <span class="small muted">{x.subject}</span>
                    </span>
                    <span class="badge">{x.status}</span>
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

export function TicketView({ id }: { id: string }) {
  const state = useLoad(
    () =>
      api<Ticket & { messages: { id: string; is_staff: boolean; body: string; created_at: string }[] }>('GET', `/support/tickets/${id}`),
    [id],
  );
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function reply(e: Event) {
    e.preventDefault();
    try {
      await api('POST', `/support/tickets/${id}/messages`, { body });
      setBody('');
      state.reload();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  return (
    <main class="screen">
      <Loadable state={state}>
        {(tk) => (
          <>
            <h1>{tk.reference}</h1>
            <p class="muted">{tk.subject}</p>
            {tk.messages.map((m) => (
              <div key={m.id} class={`bubble ${m.is_staff ? 'staff' : ''}`}>
                <div class="small muted">
                  {m.is_staff ? t('support.staff') : t('support.you')} ·{' '}
                  {new Date(m.created_at).toLocaleString(getLocale() === 'fa' ? 'fa-IR' : 'en-GB')}
                </div>
                {m.body}
              </div>
            ))}
            {tk.status !== 'closed' && (
              <form onSubmit={reply} class="card">
                <Field label={t('support.reply')} id="rb">
                  <textarea id="rb" required maxLength={4000} value={body} onInput={(e) => setBody(e.currentTarget.value)} />
                </Field>
                {err && <p class="error">{err}</p>}
                <button class="block">{t('support.send')}</button>
              </form>
            )}
          </>
        )}
      </Loadable>
    </main>
  );
}
