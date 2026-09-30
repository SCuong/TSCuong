import { useEffect, useRef, useState } from 'react';
import { Download, ImageUp, X } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { FileDrop } from '@/components/ui/FileDrop';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useToolState, nextFrame } from '@/lib/hooks';
import { baseName, downloadBlob, formatBytes } from '@/lib/utils';
import { VISION_TYPES, type VisionType } from '../lib/cvd';
import { MAX_IMAGE_SIDE, fitSize, simulatePixels } from '../lib/cvdImage';

const TOOL = 'color-blindness-simulator';
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif';
/** Pixels processed between repaints, so large images never freeze the page. */
const CHUNK_BYTES = 4 * 250_000;

type Simulated = Exclude<VisionType, 'normal'>;

interface LoadedImage {
  name: string;
  size: number;
  width: number;
  height: number;
  scaled: boolean;
  pixels: ImageData;
}

async function decode(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const fit = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
    return { name: file.name, size: file.size, ...fit, pixels: ctx.getImageData(0, 0, fit.width, fit.height) };
  } finally {
    bitmap.close();
  }
}

/** Simulates color vision deficiency on an image the user opens (processed locally, in chunks). */
export function ImageSimulator() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [type, setType] = useToolState<Simulated>(TOOL, 'imageType', 'deuteranopia');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const original = useRef<HTMLCanvasElement>(null);
  const simulated = useRef<HTMLCanvasElement>(null);
  const info = VISION_TYPES.find((v) => v.id === type) ?? VISION_TYPES[2];

  async function open(file: File) {
    setError(null);
    setLoading(true);
    try {
      setImage(await decode(file));
    } catch {
      setImage(null);
      setError('This file could not be opened as an image. Try a PNG, JPEG, WebP or GIF file.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (image && original.current) original.current.getContext('2d')?.putImageData(image.pixels, 0, 0);
  }, [image]);

  useEffect(() => {
    const canvas = simulated.current;
    if (!image || !canvas) return;
    let cancelled = false;
    const src = image.pixels.data;
    const out = new ImageData(image.width, image.height);
    setBusy(true);
    void (async () => {
      for (let from = 0; from < src.length; from += CHUNK_BYTES) {
        simulatePixels(src, type, out.data, from, Math.min(src.length, from + CHUNK_BYTES));
        if (from + CHUNK_BYTES < src.length) await nextFrame();
        if (cancelled) return;
      }
      canvas.getContext('2d')?.putImageData(out, 0, 0);
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [image, type]);

  function save() {
    const canvas = simulated.current;
    if (!canvas || !image) return;
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${baseName(image.name)}-${type}.png`, 'image/png');
      else toast('The image could not be saved.', 'error');
    }, 'image/png');
  }

  if (!image) {
    return (
      <Panel bodyClassName="flex flex-col gap-3">
        <FileDrop
          accept={ACCEPT}
          onFiles={(files) => void open(files[0])}
          icon={ImageUp}
          title="Drop an image or screenshot here"
          hint="PNG, JPEG, WebP or GIF. It is processed on this device and never uploaded."
          disabled={loading}
        />
        {loading && <Spinner label="Opening the image…" />}
        <ErrorMessage error={error} />
      </Panel>
    );
  }

  return (
    <Panel
      title={image.name}
      description={`${image.width} × ${image.height} px · ${formatBytes(image.size)}${image.scaled ? ` · scaled to fit ${MAX_IMAGE_SIDE} px` : ''}`}
      actions={
        <>
          <Button size="sm" icon={Download} onClick={save} disabled={busy}>
            Save PNG
          </Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => setImage(null)}>
            Close
          </Button>
        </>
      }
      bodyClassName="flex flex-col gap-3"
    >
      <div>
        <Segmented
          label="Vision type"
          value={type}
          onChange={setType}
          className="flex-wrap"
          options={VISION_TYPES.filter((v) => v.id !== 'normal').map((v) => ({ value: v.id as Simulated, label: v.label }))}
        />
      </div>
      <p className="text-[12.5px] text-fg-secondary">
        {info.description} {info.prevalence && `(${info.prevalence})`}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <figure className="m-0 min-w-0">
          <div className="lk-checker overflow-hidden rounded-lg border border-line">
            <canvas ref={original} width={image.width} height={image.height} className="block h-auto w-full" role="img" aria-label={`Original: ${image.name}`} />
          </div>
          <figcaption className="mt-1.5 text-[12.5px] text-fg-secondary">Typical vision</figcaption>
        </figure>
        <figure className="m-0 min-w-0">
          <div className="lk-checker relative overflow-hidden rounded-lg border border-line">
            <canvas ref={simulated} width={image.width} height={image.height} className="block h-auto w-full" role="img" aria-label={`${info.label} simulation of ${image.name}`} />
            {busy && (
              <div className="absolute top-2 left-2 rounded-md bg-surface-raised px-2 py-1 shadow-card">
                <Spinner size={13} label="Simulating…" />
              </div>
            )}
          </div>
          <figcaption className="mt-1.5 text-[12.5px] text-fg-secondary">{info.label}</figcaption>
        </figure>
      </div>
    </Panel>
  );
}
