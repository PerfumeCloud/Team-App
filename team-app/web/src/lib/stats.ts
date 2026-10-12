import { create } from 'zustand';
import { api } from './api';
import type { Stats } from './types';

interface StatsState {
  data: Record<number, Stats>;
  loading: Record<number, boolean>;
  error: string | null;
  load: (days: number) => Promise<void>;
}

const KEY = 'pc-stats-v1';

function cached(): Record<number, Stats> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Statistik wird separat geladen und zwischengespeichert (bleibt beim Neuladen sichtbar). */
export const useStats = create<StatsState>((set, get) => ({
  data: cached(),
  loading: {},
  error: null,
  async load(days) {
    if (get().loading[days]) return;
    set({ loading: { ...get().loading, [days]: true } });
    try {
      const s = await api<Stats>('GET', `/stats?days=${days}`);
      const data = { ...get().data, [days]: s };
      set({ data, error: null });
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        /* egal */
      }
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: { ...get().loading, [days]: false } });
    }
  },
}));
