import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Flashlight, X } from 'lucide-react';
import { guessCarrier, isStrongMatch, trackingCandidates } from '../lib/shipping';
import { cx, Spinner } from './ui';

type Detect = (video: HTMLVideoElement) => Promise<string[]>;

// Formate auf Paketaufklebern: DHL/Hermes/DPD/GLS meist Code 128, dazu Data Matrix, QR und ITF (Leitcode)
const NATIVE_FORMATS = ['code_128', 'code_39', 'itf', 'data_matrix', 'qr_code', 'ean_13'];
const ZXING_FORMATS = ['Code128', 'Code39', 'ITF', 'DataMatrix', 'QRCode', 'EAN13'] as const;

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type NativeDetectorClass = (new (o: { formats: string[] }) => NativeDetector) & { getSupportedFormats(): Promise<string[]> };

/** Eingebauter Barcode-Leser (Chrome/Android, Safari ab iOS 17) – sonst zxing als WebAssembly, erst bei Bedarf geladen. */
async function createDetector(): Promise<Detect> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      if (formats.includes('code_128')) {
        const d = new Native({ formats });
        return async (video) => (await d.detect(video)).map((b) => b.rawValue);
      }
    } catch {
      /* weiter mit zxing */
    }
  }
  const [{ prepareZXingModule, readBarcodes }, wasm] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path),
    },
    fireImmediately: true,
  });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (video) => {
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, 1));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    if (!canvas.width || !canvas.height) return [];
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const res = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
      formats: [...ZXING_FORMATS],
      tryHarder: true,
      maxNumberOfSymbols: 4,
    });
    return res.filter((r) => r.isValid).map((r) => r.text);
  };
}

/**
 * Sendungsnummer mit der Kamera scannen. Eindeutige Nummern (z. B. DHL JJD…/00340…) werden direkt übernommen,
 * sonst erscheinen alle gefundenen Codes zum Antippen.
 */
export function Scanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [found, setFound] = useState<{ code: string; carrier: string | null; hits: number }[]>([]);
  const [torch, setTorch] = useState<{
    on: boolean;
    track: MediaStreamTrack;
  } | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const hits = new Map<string, number>();

    const finish = (code: string) => {
      if (done.current) return;
      done.current = true;
      navigator.vibrate?.(60);
      onResult(code);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Dieser Browser kann nicht auf die Kamera zugreifen. Tipp: Safari oder Chrome verwenden – und die Seite über https öffnen.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch (e) {
        const name = (e as DOMException).name;
        setError(
          name === 'NotAllowedError'
            ? 'Kein Zugriff auf die Kamera. Bitte in den Einstellungen des Geräts bzw. Browsers die Kamera für diese App erlauben.'
            : 'Kamera nicht verfügbar: ' + ((e as Error).message || name),
        );
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      if (caps.torch) setTorch({ on: false, track });

      let detect: Detect;
      try {
        detect = await createDetector();
      } catch {
        setError('Der Barcode-Leser konnte nicht geladen werden. Bitte die Nummer eintippen.');
        return;
      }
      setReady(true);
      const loop = async () => {
        if (stopped || done.current) return;
        try {
          if (video.readyState >= 2) {
            const codes = (await detect(video)).flatMap(trackingCandidates);
            for (const c of codes) {
              const n = (hits.get(c) ?? 0) + 1;
              hits.set(c, n);
              // Zweimal gleich gelesen und eindeutig → übernehmen
              if (n >= 2 && isStrongMatch(c)) return finish(c);
            }
            if (codes.length) {
              setFound(
                [...hits.entries()]
                  .map(([code, n]) => ({
                    code,
                    carrier: guessCarrier(code),
                    hits: n,
                  }))
                  .sort((a, b) => Number(!!b.carrier) - Number(!!a.carrier) || b.hits - a.hits)
                  .slice(0, 5),
              );
            }
          }
        } catch {
          /* einzelnes Bild nicht lesbar */
        }
        timer = window.setTimeout(loop, 220);
      };
      void loop();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  async function toggleTorch() {
    if (!torch) return;
    try {
      await torch.track.applyConstraints({
        advanced: [{ torch: !torch.on } as MediaTrackConstraintSet],
      });
      setTorch({ ...torch, on: !torch.on });
    } catch {
      setTorch(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Sendungsnummer scannen">
      <div className="safe-top flex items-center justify-between px-4 py-3">
        <span className="text-[15px] font-semibold">Sendungsnummer scannen</span>
        <div className="flex gap-2">
          {torch && (
            <button
              onClick={toggleTorch}
              aria-label="Taschenlampe"
              className={cx('flex h-10 w-10 items-center justify-center rounded-full', torch.on ? 'bg-white text-black' : 'bg-white/15')}
            >
              <Flashlight className="h-5 w-5" />
            </button>
          )}
          <button onClick={onClose} aria-label="Schließen" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[34%] w-[84%] max-w-[520px] rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="text-white" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="flex max-w-sm gap-2 rounded-2xl bg-white/10 p-4 text-[14px] leading-relaxed">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" /> {error}
            </p>
          </div>
        )}
      </div>
      <div className="safe-bottom px-4 pb-4 pt-3">
        {found.length > 0 ? (
          <>
            <p className="mb-2 text-[13px] text-white/70">Gefunden – richtige Nummer antippen:</p>
            <div className="flex flex-wrap gap-2">
              {found.map((f) => (
                <button key={f.code} onClick={() => onResult(f.code)} className="rounded-xl bg-white px-3 py-2 text-left text-black active:scale-[0.98]">
                  <span className="block font-mono text-[14px] font-semibold">{f.code}</span>
                  <span className="block text-[12px] text-black/60">{f.carrier ?? 'Unbekanntes Format'}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-[13px] text-white/70">
            Barcode der Sendungsnummer in den Rahmen halten. Eindeutige Nummern werden automatisch übernommen.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
