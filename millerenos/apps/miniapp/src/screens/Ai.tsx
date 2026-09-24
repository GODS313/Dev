import { useState } from 'preact/hooks';
import { api } from '../api';
import { useApp } from '../app';
import { t } from '../i18n';
import { errorMessage, Field, toast } from '../ui';

interface Suggestion {
  id: string;
  text: string;
  requiresApproval: boolean;
}

export function Ai() {
  const { ws } = useApp();
  const wid = ws.workspace.id;
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Suggestion | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);

  async function run(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    setReviewed(null);
    try {
      setResult(await api<Suggestion>('POST', `/workspaces/${wid}/ai/reply-suggestion`, { customerMessage: msg }));
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  }
  async function review(decision: 'approved' | 'rejected') {
    if (!result) return;
    try {
      await api('POST', `/workspaces/${wid}/ai/suggestions/${result.id}/review`, { decision });
      setReviewed(decision);
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      toast(t('app.copied'));
    } catch {
      /* clipboard may be unavailable in some clients */
    }
  }

  return (
    <main class="screen">
      <h1>{t('ai.title')}</h1>
      <p class="muted">{t('ai.intro')}</p>
      <form class="card" onSubmit={run}>
        <Field label={t('ai.message')} id="cm">
          <textarea id="cm" required maxLength={2000} value={msg} onInput={(e) => setMsg(e.currentTarget.value)} />
        </Field>
        <button class="block" disabled={busy || !msg.trim()}>
          {busy ? t('app.loading') : t('ai.generate')}
        </button>
      </form>
      {err && (
        <p class="error" role="alert">
          {err}
        </p>
      )}
      {result && (
        <section class="card" aria-live="polite">
          <h2>{t('ai.result')}</h2>
          <div class="bubble">{result.text}</div>
          {result.requiresApproval && !reviewed && (
            <>
              <p class="small muted">{t('ai.pending')}</p>
              <div class="row">
                <button onClick={() => review('approved')}>{t('ai.approve')}</button>
                <button class="danger" onClick={() => review('rejected')}>
                  {t('ai.reject')}
                </button>
              </div>
            </>
          )}
          {(!result.requiresApproval || reviewed === 'approved') && (
            <button class="secondary" onClick={copy}>
              {t('app.copy')}
            </button>
          )}
          <p class="small muted" style={{ marginTop: '10px' }}>
            {t('ai.disclaimer')}
          </p>
        </section>
      )}
    </main>
  );
}
