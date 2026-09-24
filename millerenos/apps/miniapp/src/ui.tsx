import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError } from './api';
import { t, type Key } from './i18n';

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const known: Record<string, Key> = {
      network: 'app.error.network',
      access_expired: 'app.error.access_expired',
      quota_exceeded: 'app.error.quota_exceeded',
      not_configured: 'app.error.not_configured',
      rate_limited: 'app.error.rate_limited',
      feature_disabled: 'app.error.feature_disabled',
    };
    const key = known[err.code];
    if (key) return t(key);
    if (err.status < 500 && err.message) return err.message;
  }
  return t('app.error.generic');
}

/** Loads data with loading / error / retry states. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

export function Loadable<T>({
  state,
  children,
  skeletons = 3,
}: {
  state: ReturnType<typeof useLoad<T>>;
  children: (data: T) => ComponentChildren;
  skeletons?: number;
}) {
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.loading && state.data === undefined)
    return (
      <div aria-busy="true" aria-label={t('app.loading')}>
        {Array.from({ length: skeletons }, (_, i) => (
          <div class="skeleton" key={i} />
        ))}
      </div>
    );
  return <>{children(state.data as T)}</>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div class="card" role="alert">
      <p class="error">{errorMessage(error)}</p>
      {onRetry && (
        <button class="secondary" onClick={onRetry}>
          {t('app.retry')}
        </button>
      )}
    </div>
  );
}

export function Field(props: { label: string; id: string; children: ComponentChildren; hint?: string }) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      {props.children}
      {props.hint && <p class="small muted">{props.hint}</p>}
    </div>
  );
}

export function Empty({ text, action }: { text: string; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <p>{text}</p>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span class={`badge ${status}`}>{t(`status.${status}` as Key)}</span>;
}

let toastSetter: ((msg: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSetter?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  toastSetter = setMsg;
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(id);
  }, [msg]);
  return msg ? (
    <div class="toast" role="status" aria-live="polite">
      {msg}
    </div>
  ) : null;
}

const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  products: 'M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4',
  orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  ai: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
