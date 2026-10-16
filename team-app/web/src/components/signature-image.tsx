import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, Spinner } from './ui';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import type { SignatureImage } from '../lib/types';

/** Größte Datei, die der Server annimmt – darunter wird das Bild notfalls stärker komprimiert. */
const MAX_BYTES = 380_000;

/**
 * Bild auf höchstens 1200 px Breite bringen (scharf auf Retina bei bis zu 600 px Anzeige).
 * PNG bleibt PNG (Transparenz, z. B. Logo oder Unterschrift), Fotos werden JPEG.
 */
async function prepare(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Das Bild ließ sich nicht öffnen.'));
      i.src = url;
    });
    const scale = Math.min(1, 1200 / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const size = (d: string) => Math.ceil(((d.length - d.indexOf(',') - 1) * 3) / 4);
    if (file.type === 'image/png' || file.type === 'image/gif') {
      const png = canvas.toDataURL('image/png');
      if (size(png) <= MAX_BYTES) return png;
    }
    // JPEG braucht einen hellen Hintergrund statt Transparenz
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    for (const q of [0.9, 0.8, 0.7, 0.55]) {
      const jpg = flat.toDataURL('image/jpeg', q);
      if (size(jpg) <= MAX_BYTES) return jpg;
    }
    throw new Error('Das Bild ist zu groß. Bitte ein kleineres wählen.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Bild unter der Signatur hochladen, Größe einstellen, entfernen.
 * endpoint: /me/signature (eigene Signatur) oder /admin/mail-signature (Fußzeile der Team-Postfächer).
 */
export function SignatureImageField({ endpoint, label, onChange }: { endpoint: string; label: string; onChange?: (v: SignatureImage) => void }) {
  const [v, setV] = useState<SignatureImage | null>(null);
  const [width, setWidth] = useState(220);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<SignatureImage>('GET', endpoint)
      .then((r) => {
        setV(r);
        setWidth(r.width);
        onChange?.(r);
      })
      .catch((e) => toast((e as Error).message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  async function save(body: { image?: string | null; width?: number }) {
    setBusy(true);
    try {
      const r = await api<SignatureImage>('PUT', endpoint, body);
      setV(r);
      setWidth(r.width);
      onChange?.(r);
      toast(body.image === null ? 'Bild entfernt' : 'Bild gespeichert', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Bitte ein Bild wählen (PNG, JPEG oder GIF).', 'error');
      return;
    }
    try {
      await save({ image: await prepare(file), width });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (!v) return <Spinner />;

  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="label mb-2">{label}</div>
      {v.image ? (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl bg-white p-3">
            <img src={v.image} alt="" style={{ width: Math.min(width, 600), maxWidth: '100%' }} className="block h-auto" />
          </div>
          <label className="block">
            <span className="flex items-center justify-between text-[13px] text-ink-2">
              <span>Breite in der Mail</span>
              <span className="tnum text-ink-3">{width} px</span>
            </span>
            <input
              type="range"
              min={60}
              max={600}
              step={10}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              onPointerUp={() => width !== v.width && void save({ width })}
              onKeyUp={() => width !== v.width && void save({ width })}
              className="mt-1 w-full accent-accent"
              aria-label="Breite des Bildes in der Mail"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} loading={busy} onClick={() => input.current?.click()}>
              Anderes Bild
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={busy} onClick={() => void save({ image: null })}>
              Entfernen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" icon={<ImagePlus className="h-3.5 w-3.5" />} loading={busy} onClick={() => input.current?.click()}>
            Bild hinzufügen
          </Button>
          <span className="text-[12px] text-ink-3">z. B. Logo oder eingescannte Unterschrift · PNG, JPEG oder GIF</span>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
