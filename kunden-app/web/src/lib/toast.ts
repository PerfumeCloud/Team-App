type Listener = (msg: string | null) => void;
const listeners = new Set<Listener>();
let timer: number | undefined;

export function toast(msg: string): void {
  window.clearTimeout(timer);
  listeners.forEach((l) => l(msg));
  timer = window.setTimeout(() => listeners.forEach((l) => l(null)), 3200);
}

export function onToast(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
