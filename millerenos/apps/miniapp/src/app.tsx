import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Me, WorkspaceDetail, WorkspaceRef } from './api';

export type Route =
  | { name: 'home' }
  | { name: 'products' }
  | { name: 'product'; id?: string }
  | { name: 'orders' }
  | { name: 'order'; id: string }
  | { name: 'ai' }
  | { name: 'more' }
  | { name: 'store' }
  | { name: 'customers' }
  | { name: 'plans' }
  | { name: 'support' }
  | { name: 'ticket'; id: string }
  | { name: 'settings' }
  | { name: 'admin' };

export interface AppCtx {
  me: Me;
  workspaces: WorkspaceRef[];
  ws: WorkspaceDetail;
  refresh: () => Promise<void>;
  go: (r: Route) => void;
  back: () => void;
  changeLocale: (l: 'en' | 'fa') => Promise<void>;
}

export const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;
