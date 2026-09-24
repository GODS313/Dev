import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { api, setToken, type Me, type WorkspaceDetail, type WorkspaceRef } from './api';
import { Ctx, type AppCtx, type Route } from './app';
import { setLocale, t } from './i18n';
import { Ai } from './screens/Ai';
import { Home } from './screens/Home';
import { Admin, Customers, More, Plans, Settings, StoreSettings } from './screens/More';
import { Onboarding } from './screens/Onboarding';
import { OrderView, Orders } from './screens/Orders';
import { ProductEdit, Products } from './screens/Products';
import { Shop } from './screens/Shop';
import { Support, TicketView } from './screens/Support';
import './styles.css';
import { launchParams, tg } from './tg';
import { ErrorBox, Icon, ToastHost } from './ui';

const TABS = ['home', 'products', 'orders', 'ai', 'more'] as const;
const PAGE_TO_ROUTE: Record<string, Route> = {
  products: { name: 'products' },
  orders: { name: 'orders' },
  ai: { name: 'ai' },
  support: { name: 'support' },
  plans: { name: 'plans' },
};

function App() {
  const params = launchParams();
  const [boot, setBoot] = useState<{ me: Me; workspaces: WorkspaceRef[]; trialUsed: boolean } | { error: unknown } | null>(null);
  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [stack, setStack] = useState<Route[]>([PAGE_TO_ROUTE[params.page ?? ''] ?? { name: 'home' }]);
  const route = stack[stack.length - 1]!;

  const signIn = useCallback(async () => {
    setBoot(null);
    try {
      if (!tg) throw new Error('not-in-telegram');
      const auth = await api<{ token: string; user: Me; workspaces: WorkspaceRef[] }>('POST', '/auth/telegram', { initData: tg.initData });
      setToken(auth.token);
      setLocale(auth.user.locale);
      const me = await api<{ trialUsed: boolean }>('GET', '/me');
      setBoot({ me: auth.user, workspaces: auth.workspaces, trialUsed: me.trialUsed });
    } catch (error) {
      setBoot({ error });
    }
  }, []);

  const loadWorkspace = useCallback(async (id: string) => setWs(await api<WorkspaceDetail>('GET', `/workspaces/${id}`)), []);

  useEffect(() => {
    if (!tg && matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.scheme = 'dark';
    if (tg) {
      tg.ready();
      tg.expand();
      document.documentElement.classList.add('tg');
      document.documentElement.dataset.scheme = tg.colorScheme;
      tg.onEvent('themeChanged', () => (document.documentElement.dataset.scheme = tg!.colorScheme));
      setLocale(tg.initDataUnsafe.user?.language_code?.startsWith('fa') ? 'fa' : 'en');
    }
    void signIn();
  }, [signIn]);

  useEffect(() => {
    if (boot && 'me' in boot && boot.workspaces[0] && !params.store)
      loadWorkspace(boot.workspaces[0].id).catch((error) => setBoot({ error }));
  }, [boot]);

  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  useEffect(() => {
    if (!tg) return;
    if (stack.length > 1) tg.BackButton.show();
    else tg.BackButton.hide();
    tg.BackButton.onClick(back);
    return () => tg!.BackButton.offClick(back);
  }, [stack, back]);

  if (!tg)
    return (
      <main class="screen">
        <h1>Millerenos</h1>
        <p>{t('app.open_in_telegram')}</p>
      </main>
    );
  if (!boot)
    return (
      <div class="boot" role="status">
        {t('app.loading')}
      </div>
    );
  if ('error' in boot)
    return (
      <main class="screen">
        <ErrorBox error={boot.error} onRetry={signIn} />
      </main>
    );

  if (params.store)
    return (
      <>
        <Shop slug={params.store} signedIn />
        <ToastHost />
      </>
    );

  if (boot.workspaces.length === 0)
    return (
      <Onboarding
        trialUsed={boot.trialUsed}
        firstName={boot.me.firstName}
        onDone={async () => {
          const me = await api<{ workspaces: WorkspaceRef[]; trialUsed: boolean }>('GET', '/me');
          setBoot({ me: boot.me, workspaces: me.workspaces, trialUsed: true });
        }}
      />
    );
  if (!ws)
    return (
      <div class="boot" role="status">
        {t('app.loading')}
      </div>
    );

  const ctx: AppCtx = {
    me: boot.me,
    workspaces: boot.workspaces,
    ws,
    refresh: () => loadWorkspace(ws.workspace.id),
    go: (r) => setStack((s) => ((TABS as readonly string[]).includes(r.name) ? [r] : [...s, r])),
    back,
    changeLocale: async (l) => {
      await api('PATCH', '/me', { locale: l });
      setLocale(l);
      setBoot({ ...boot, me: { ...boot.me, locale: l } });
    },
  };
  const tab = (TABS as readonly string[]).includes(route.name)
    ? route.name
    : (stack.find((r) => (TABS as readonly string[]).includes(r.name))?.name ?? 'more');

  return (
    <Ctx.Provider value={ctx}>
      <Screen route={route} />
      <nav class="tabs" aria-label="Main">
        {TABS.map((name) => (
          <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => ctx.go({ name } as Route)}>
            <Icon name={name} />
            {t(`nav.${name}`)}
          </button>
        ))}
      </nav>
      <ToastHost />
    </Ctx.Provider>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'products':
      return <Products />;
    case 'product':
      return <ProductEdit id={route.id} key={route.id ?? 'new'} />;
    case 'orders':
      return <Orders />;
    case 'order':
      return <OrderView id={route.id} />;
    case 'ai':
      return <Ai />;
    case 'more':
      return <More />;
    case 'store':
      return <StoreSettings />;
    case 'customers':
      return <Customers />;
    case 'plans':
      return <Plans />;
    case 'support':
      return <Support />;
    case 'ticket':
      return <TicketView id={route.id} />;
    case 'settings':
      return <Settings />;
    case 'admin':
      return <Admin />;
  }
}

render(<App />, document.getElementById('root')!);
