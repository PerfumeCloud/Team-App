import { createContext, useContext } from 'react';
import type { Me, OrdersResponse, Status } from './types';

export const StatusCtx = createContext<Status | null>(null);

export function useStatus(): Status {
  const s = useContext(StatusCtx);
  if (!s) throw new Error('Status fehlt');
  return s;
}

export interface KundeKontext {
  me: Me;
  setMe: (me: Me) => void;
  reloadMe: () => Promise<void>;
  orders: OrdersResponse | null;
  ordersLoading: boolean;
  ordersError: string | null;
  loadOrders: (fresh?: boolean) => Promise<void>;
}

export const KundeCtx = createContext<KundeKontext | null>(null);

export function useKunde(): KundeKontext {
  const k = useContext(KundeCtx);
  if (!k) throw new Error('Nicht angemeldet');
  return k;
}
