import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Eye, EyeOff, ExternalLink, ScanLine, Trash, Upload } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { useObjectUrl } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { createCanvas, decodeImage, fitWithin, getContext } from '../image/lib/canvas';
import { scaledBitmap } from '../image/lib/pipeline';
import { IMAGE_ACCEPT } from '../image/lib/accept';
import { detectContent } from './lib/content';
import { disposeScanner, formatLabel, scan, warmUpScanner, type ScanHit } from './lib/zxing';

type Source = 'image' | 'camera';

interface Found {
  id: number;
  format: string;
  text: string;
  at: number;
  position?: ScanHit['position'];
}

let seq = 0;

/** Longest side handed to the decoder (zxing also tries smaller scales itself). */
const MAX_SCAN_SIDE = 4096;

/** Decode an image file with the browser and return its pixels (downscaled if huge). */
async function imagePixels(file: File): Promise<{ data: ImageData; scale: number }> {
  const decoded = await decodeImage(file);
  let bitmap = decoded.bitmap;
  try {
    const size = fitWithin(decoded.width, decoded.height, MAX_SCAN_SIDE);
    // Huge photos are scaled off the main thread first.
    if (size.width < decoded.width) bitmap = await scaledBitmap(decoded.bitmap, size.width, size.height);
    const canvas = createCanvas(bitmap.width, bitmap.height);
    const ctx = getContext(canvas, { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    return { data: ctx.getImageData(0, 0, canvas.width, canvas.height), scale: bitmap.width / decoded.width };
  } finally {
    bitmap.close();
    decoded.bitmap.close();
  }
}

function scalePosition(p: ScanHit['position'], k: number): ScanHit['position'] {
  if (k === 1) return p;
  const s = (q: { x: number; y: number }) => ({ x: q.x * k, y: q.y * k });
  return { topLeft: s(p.topLeft), topRight: s(p.topRight), bottomRight: s(p.bottomRight), bottomLeft: s(p.bottomLeft) };
}

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was denied. Allow camera access for this site in your browser settings, or scan an image instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is already in use by another app or tab, or could not be started.';
  if (name === 'NotSupportedError') return 'This browser cannot use a camera on this page. Scan an image instead.';
  return errorMessage(e, 'The camera could not be started.');
}

function ResultCard({ r, onRemove }: { r: Found; onRemove: () => void }) {
  const [reveal, setReveal] = useState(false);
  const content = detectContent(r.text);
  return (
    <li className="rounded-lg border border-line bg-surface-sunken p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{formatLabel(r.format)}</Badge>
        <Badge>{content.label}</Badge>
        <span className="ml-auto flex items-center gap-1">
          <CopyButton value={r.text} iconOnly label="Copy text" />
          <IconButton icon={Trash} size="sm" label="Remove result" onClick={onRemove} />
        </span>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto font-mono text-[12.5px] break-all whitespace-pre-wrap text-fg">{r.text}</pre>
      {content.fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 border-t border-line pt-2 text-[12.5px]">
          {content.fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="contents">
              <dt className="text-fg-muted">{f.label}</dt>
              <dd className="flex min-w-0 items-center gap-1 break-all text-fg">
                {f.secret && !reveal ? '•'.repeat(Math.min(12, f.value.length)) : f.value}
                {f.secret && (
                  <IconButton icon={reveal ? EyeOff : Eye} size="sm" label={reveal ? 'Hide password' : 'Show password'} onClick={() => setReveal(!reveal)} />
                )}
                {f.secret && <CopyButton value={f.value} iconOnly label="Copy password" />}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {content.href && /^https?:/i.test(content.href) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={ExternalLink} onClick={() => window.open(content.href, '_blank', 'noopener,noreferrer')}>
            {content.kind === 'geo' ? 'Open map (external)' : 'Open link (external)'}
          </Button>
          <span className="text-[12px] text-fg-muted">Check the address before opening. Links are never opened automatically.</span>
        </div>
      )}
    </li>
  );
}

export default function QrScanner() {
  const [source, setSource] = useState<Source>('image');
  const [results, setResults] = useState<Found[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noneFound, setNoneFound] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const fileUrl = useObjectUrl(file);
  const scanSeq = useRef(0);

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [cameraMsg, setCameraMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const addResults = useCallback((list: ScanHit[], replace: boolean) => {
    setResults((prev) => {
      const base = replace ? [] : prev;
      const next = [...base];
      for (const r of list) {
        if (next.some((x) => x.text === r.text && x.format === r.format)) continue;
        next.unshift({ id: ++seq, format: r.format, text: r.text, at: Date.now(), position: r.position });
      }
      return next.slice(0, 50);
    });
  }, []);

  async function scanFile(f: File) {
    const id = ++scanSeq.current;
    setFile(f);
    setBusy(true);
    setError(null);
    setNoneFound(false);
    try {
      // Decode with the browser (WebP, AVIF, SVG, ICO, EXIF rotation, clear errors for
      // HEIC or non-images), then hand zxing the pixels.
      const { data, scale } = await imagePixels(f);
      const found = await scan(data);
      if (id !== scanSeq.current) return;
      addResults(found.map((r) => ({ ...r, position: scalePosition(r.position, 1 / scale) })), true);
      setNoneFound(found.length === 0);
    } catch (e) {
      if (id !== scanSeq.current) return;
      setError(errorMessage(e, 'This image could not be read.'));
      setResults([]);
    } finally {
      if (id === scanSeq.current) setBusy(false);
    }
  }

  // Paste an image anywhere on the page.
  useEffect(() => {
    if (source !== 'image') return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        void scanFile(item);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      clearTimeout(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);
  // The decoder worker lives while the tool is open.
  useEffect(() => () => disposeScanner(), []);
  useEffect(() => {
    if (source !== 'camera') stopCamera();
  }, [source, stopCamera]);

  async function startCamera(id = deviceId) {
    setCameraMsg(null);
    stopCamera();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Camera access needs a secure (https) page and a browser that supports it. Scan an image instead.');
      return;
    }
    try {
      warmUpScanner();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setCameras(devices);
      const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (active) setDeviceId(active);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (!streamRef.current || !ctx || !videoRef.current) return;
        const v = videoRef.current;
        if (v.videoWidth > 0) {
          const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * scale);
          canvas.height = Math.round(v.videoHeight * scale);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          try {
            const found = await scan(ctx.getImageData(0, 0, canvas.width, canvas.height), true);
            if (found.length) {
              addResults(found, false);
              setFlash(true);
              clearTimeout(flashTimer.current);
              flashTimer.current = window.setTimeout(() => setFlash(false), 500);
            }
          } catch {
            // Keep scanning; a single failed frame is not an error.
          }
        }
        if (streamRef.current) loopRef.current = window.setTimeout(() => void tick(), 220);
      };
      loopRef.current = window.setTimeout(() => void tick(), 300);
    } catch (e) {
      stopCamera();
      setCameraMsg(cameraError(e));
    }
  }

  return (
    <ToolStack>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Scan from"
          value={source}
          onChange={setSource}
          options={[
            { value: 'image', label: 'Image', icon: Upload },
            { value: 'camera', label: 'Camera', icon: Camera },
          ]}
        />
        <span className="text-[12.5px] text-fg-muted">QR, Data Matrix, Aztec, PDF417, EAN/UPC, Code 128/39/93, ITF, Codabar. Decoded on this device.</span>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {source === 'image' ? (
            <>
              <FileDrop
                accept={IMAGE_ACCEPT}
                onFiles={(f) => void scanFile(f[0])}
                icon={ScanLine}
                compact={Boolean(file)}
                title="Drop, paste or browse an image with a code"
                hint="Screenshots and photos work. Press Ctrl+V to paste from the clipboard."
              />
              {fileUrl && (
                <Panel title={file?.name ?? 'Image'} bodyClassName="p-3">
                  <div className="relative mx-auto w-fit max-w-full">
                    <img
                      src={fileUrl}
                      alt="Scanned image"
                      className="block max-h-[420px] max-w-full rounded"
                      onLoad={(e) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    />
                    {imgSize && (
                      <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${imgSize.w} ${imgSize.h}`} preserveAspectRatio="none" aria-hidden>
                        {results
                          .filter((r) => r.position)
                          .map((r) => {
                            const p = r.position!;
                            return (
                              <polygon
                                key={r.id}
                                points={[p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map((q) => `${q.x},${q.y}`).join(' ')}
                                fill="rgb(34 197 94 / 0.18)"
                                stroke="rgb(34 197 94)"
                                strokeWidth={Math.max(2, imgSize.w / 200)}
                              />
                            );
                          })}
                      </svg>
                    )}
                  </div>
                </Panel>
              )}
            </>
          ) : (
            <Panel
              title="Camera"
              actions={
                cameraOn ? (
                  <Button size="sm" icon={CameraOff} onClick={stopCamera}>
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon={Camera} onClick={() => void startCamera()}>
                    Start camera
                  </Button>
                )
              }
            >
              {cameraMsg && <Alert tone="danger">{cameraMsg}</Alert>}
              <div className={`relative overflow-hidden rounded-lg border bg-black ${flash ? 'border-success ring-2 ring-success' : 'border-line'} ${cameraOn ? '' : 'hidden'}`}>
                <video ref={videoRef} className="block aspect-video w-full object-cover" muted playsInline aria-label="Camera preview" />
                <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.25)]" />
              </div>
              {!cameraOn && !cameraMsg && (
                <EmptyState icon={Camera} title="Scan with your camera">
                  Your browser will ask for permission. Video stays on this device and the camera stops when you leave this page.
                </EmptyState>
              )}
              {cameraOn && cameras.length > 1 && (
                <div className="mt-3 max-w-xs">
                  <Label htmlFor="cam-select">Camera</Label>
                  <Select
                    id="cam-select"
                    value={deviceId}
                    onChange={(e) => {
                      setDeviceId(e.target.value);
                      void startCamera(e.target.value);
                    }}
                  >
                    {cameras.map((c, i) => (
                      <option key={c.deviceId || i} value={c.deviceId}>
                        {c.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {cameraOn && <p className="mt-2 text-[12.5px] text-fg-muted">Hold the code inside the frame. New codes are added to the list automatically.</p>}
            </Panel>
          )}
        </div>
        <Panel
          title={`Results${results.length ? ` (${results.length})` : ''}`}
          actions={results.length > 0 && <Button size="sm" variant="ghost" onClick={() => setResults([])}>Clear</Button>}
        >
          {busy && <Spinner label="Scanning…" />}
          <ErrorMessage error={error} />
          {!busy && noneFound && source === 'image' && (
            <Alert tone="info" title="No code found">
              Try a sharper or larger image, crop closer to the code, or make sure the whole code (with its quiet zone) is visible.
            </Alert>
          )}
          {results.length === 0 && !busy && !noneFound && !error && (
            <EmptyState icon={ScanLine} title="No results yet">
              {source === 'image' ? 'Drop an image to decode it.' : 'Start the camera and point it at a code.'}
            </EmptyState>
          )}
          {results.length > 0 && (
            <ul className="flex flex-col gap-3">
              {results.map((r) => (
                <ResultCard key={r.id} r={r} onRemove={() => setResults((l) => l.filter((x) => x.id !== r.id))} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ToolStack>
  );
}
