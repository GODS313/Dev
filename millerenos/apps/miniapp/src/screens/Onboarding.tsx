import { useState } from 'preact/hooks';
import { api } from '../api';
import { t } from '../i18n';
import { haptic } from '../tg';
import { errorMessage, Field } from '../ui';

export function Onboarding({ trialUsed, firstName, onDone }: { trialUsed: boolean; firstName: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (trialUsed)
    return (
      <main class="screen">
        <h1>Millerenos</h1>
        <p>{t('onb.used')}</p>
      </main>
    );
  async function start(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/trial', name.trim() ? { businessName: name.trim() } : {});
      haptic('success');
      onDone();
    } catch (e2) {
      setErr(errorMessage(e2));
      haptic('error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main class="screen">
      <h1>{t('onb.title')}</h1>
      <p class="muted">{t('onb.text')}</p>
      <form onSubmit={start} class="card">
        <Field label={t('onb.name')} id="bn">
          <input
            id="bn"
            value={name}
            maxLength={80}
            onInput={(e) => setName(e.currentTarget.value)}
            autoComplete="organization"
            placeholder={firstName ? `${firstName} Shop` : ''}
          />
        </Field>
        {err && (
          <p class="error" role="alert">
            {err}
          </p>
        )}
        <button class="block" disabled={busy}>
          {busy ? t('app.loading') : t('onb.cta')}
        </button>
      </form>
    </main>
  );
}
