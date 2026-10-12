export type ThemePref = 'auto' | 'light' | 'dark';

const KEY = 'pc-theme';
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'auto' && !!media?.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const color = dark ? '#121315' : '#F6F2EB';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* egal */
  }
  applyTheme(pref);
}

media?.addEventListener('change', () => applyTheme());
