import { ApiError } from './api';
import type { IgPost } from './types';

/** Zuschnitt für Instagram. Im Feed erlaubt Instagram Hochformat 4:5 bis Querformat 1,91:1. */
export type Crop = 'original' | '4:5' | '1:1' | '1.91:1' | '9:16';

export const CROPS: { value: Crop; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
  { value: '1.91:1', label: 'Quer' },
  { value: '9:16', label: '9:16' },
];

const RATIO: Record<Exclude<Crop, 'original'>, number> = { '4:5': 4 / 5, '1:1': 1, '1.91:1': 1.91, '9:16': 9 / 16 };

async function decode(blob: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch {
      /* z. B. älteres Safari – unten mit <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/**
 * Foto (auch HEIC vom iPhone, PNG, WebP) als JPEG für Instagram: mittig zugeschnitten,
 * lange Seite höchstens 1440 Pixel. Für den Feed wird ein zu breites/hohes Bild in den erlaubten Bereich geschnitten.
 */
export async function toInstagramJpeg(blob: Blob, crop: Crop, feed: boolean): Promise<Blob> {
  const { img, w, h, done } = await decode(blob);
  try {
    let target = crop === 'original' ? w / h : RATIO[crop];
    if (feed) target = Math.min(1.91, Math.max(0.8, target));
    let sx = 0;
    let sy = 0;
    let sw = w;
    let sh = h;
    if (w / h > target + 0.001) {
      sw = Math.round(h * target);
      sx = Math.round((w - sw) / 2);
    } else if (w / h < target - 0.001) {
      sh = Math.round(w / target);
      sy = Math.round((h - sh) / 2);
    }
    const scale = Math.min(1, 1440 / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden.'))), 'image/jpeg', 0.9),
    );
  } finally {
    done();
  }
}

export async function uploadInstagramImage(postId: string, jpeg: Blob): Promise<IgPost> {
  const res = await fetch(`/api/instagram/posts/${postId}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'X-PC': '1' },
    credentials: 'same-origin',
    body: jpeg,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Fehler ${res.status}`);
  return data as IgPost;
}

/** Produktbild aus Shopify über den eigenen Server laden (nur cdn.shopify.com). */
export async function fetchShopifyImage(url: string): Promise<Blob> {
  const res = await fetch('/api/instagram/shopify-image?url=' + encodeURIComponent(url), { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'Produktbild konnte nicht geladen werden.');
  }
  return res.blob();
}
