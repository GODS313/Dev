import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app';
import { duration, num, t, type Key } from '../i18n';
import { openTelegramShare } from '../tg';

const STEP_ACTION: Record<string, 'product' | 'store' | 'orders' | null> = {
  business_created: null,
  product_added: 'product',
  store_published: 'store',
  first_order: 'orders',
};

export function TrialBanner() {
  const { ws, go } = useApp();
  const a = ws.access;
  const [left, setLeft] = useState(a.state === 'trial' ? a.secondsLeft : 0);
  useEffect(() => {
    if (a.state !== 'trial') return;
    const started = Date.now();
    const base = a.secondsLeft;
    const id = setInterval(() => setLeft(Math.max(0, base - Math.floor((Date.now() - started) / 1000))), 1000);
    return () => clearInterval(id);
  }, [a]);
  if (a.state === 'trial')
    return (
      <div class="banner trial row between" role="timer" aria-live="off">
        <span>{t('home.trial_left', { time: duration(left) })}</span>
        <button class="ghost" onClick={() => go({ name: 'plans' })}>
          {t('home.choose_plan')}
        </button>
      </div>
    );
  if (a.state === 'expired')
    return (
      <div class="banner expired">
        <p>{t('home.trial_over')}</p>
        <button onClick={() => go({ name: 'plans' })}>{t('home.choose_plan')}</button>
      </div>
    );
  return <div class="banner trial">{t('home.plan_active', { plan: a.plan })}</div>;
}

export function Home() {
  const { ws, go } = useApp();
  const pct = Math.round((ws.onboarding.completed / ws.onboarding.total) * 100);
  return (
    <main class="screen">
      <h1>{ws.workspace.name}</h1>
      <TrialBanner />
      {ws.onboarding.completed < ws.onboarding.total && (
        <section class="card" aria-labelledby="chk">
          <h2 id="chk">{t('home.checklist')}</h2>
          <div class="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          {ws.onboarding.steps.map((s) => {
            const action = STEP_ACTION[s.key];
            const label = t(`home.step.${s.key}` as Key);
            return (
              <div class={`step ${s.done ? 'done' : ''}`} key={s.key}>
                <span class="dot" aria-hidden="true">
                  {s.done ? '✓' : ''}
                </span>
                {!s.done && action ? (
                  <button class="ghost" onClick={() => go(action === 'product' ? { name: 'product' } : { name: action })}>
                    {label}
                  </button>
                ) : (
                  <span>
                    {label}
                    <span class="sr-only">{s.done ? ' ✓' : ''}</span>
                  </span>
                )}
              </div>
            );
          })}
        </section>
      )}
      <div class="grid2">
        <button class="card secondary" onClick={() => go({ name: 'products' })}>
          <div>
            <div class="stat">{num(ws.usage.products)}</div>
            <div class="muted small">{t('home.stats.products')}</div>
          </div>
        </button>
        <button class="card secondary" onClick={() => go({ name: 'orders' })}>
          <div>
            <div class="stat">{num(ws.usage.orders)}</div>
            <div class="muted small">{t('home.stats.orders')}</div>
          </div>
        </button>
      </div>
      {ws.storeLink ? (
        <button
          class="block"
          disabled={!ws.workspace.store_published}
          onClick={() => openTelegramShare(ws.storeLink!, `${t('home.share_text')} — ${ws.workspace.name}`)}
        >
          {t('home.share')}
        </button>
      ) : null}
      {ws.storeLink && !ws.workspace.store_published && <p class="small muted">{t('home.share_hint')}</p>}
      {!ws.storeLink ? <p class="small muted">{t('home.no_link')}</p> : null}
    </main>
  );
}
