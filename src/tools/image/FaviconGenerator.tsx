import { useEffect, useMemo, useState } from 'react';
import { FileArchive, Star } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Checkbox, Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { downloadBlob, errorMessage } from '@/lib/utils';
import { ColorField, RangeField } from './components/controls';
import { canvasToBlob, createCanvas, decodeImage, getContext, rasterizeSvg, svgIntrinsicSize, type AnyCanvas, type Drawable } from './lib/canvas';
import { buildIco, renderSquare } from './lib/favicon';
import { buildHtml, buildManifest, FAVICON_FILES, letterMarkText } from './lib/faviconSet';
import { zipBlobs } from './lib/zip';
import { IMAGE_ACCEPT } from './lib/accept';

type Source = 'image' | 'text';
type Shape = 'square' | 'rounded' | 'circle';

interface Rendered {
  name: string;
  size: number;
  blob: Blob;
  url: string;
  label: string;
}

function drawLetterMark(text: string, fg: string, bg: string, shape: Shape, weight: string): AnyCanvas {
  const S = 1024;
  const c = createCanvas(S, S);
  const ctx = getContext(c);
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, S, S, shape === 'rounded' ? S * 0.22 : 0);
  ctx.fill();
  if (!text) return c;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const family = `${weight} %spx "Geist Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let size = S * (text.length === 1 ? 0.62 : text.length === 2 ? 0.5 : 0.38);
  ctx.font = family.replace('%s', String(size));
  const maxW = S * (shape === 'circle' ? 0.7 : 0.8);
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    size *= maxW / w;
    ctx.font = family.replace('%s', String(size));
  }
  const m = ctx.measureText(text);
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  ctx.fillText(text, S / 2, S / 2 + h / 2 - m.actualBoundingBoxDescent);
  return c;
}

export default function FaviconGenerator() {
  const [source, setSource] = useToolState<Source>('image-favicon', 'source', 'image');
  const [text, setText] = useToolState('image-favicon', 'text', 'LK');
  const [fg, setFg] = useToolState('image-favicon', 'fg', '#ffffff');
  const [bg, setBg] = useToolState('image-favicon', 'bg', '#2563eb');
  const [shape, setShape] = useToolState<Shape>('image-favicon', 'shape', 'rounded');
  const [weight, setWeight] = useToolState('image-favicon', 'weight', '700');
  const [padding, setPadding] = useToolState('image-favicon', 'padding', 0);
  const [fillBg, setFillBg] = useToolState('image-favicon', 'fillBg', false);
  const [imageBg, setImageBg] = useToolState('image-favicon', 'imageBg', '#ffffff');
  const [name, setName] = useToolState('image-favicon', 'name', 'My Website');
  const [themeColor, setThemeColor] = useToolState('image-favicon', 'theme', '#2563eb');
  const [path, setPath] = useToolState('image-favicon', 'path', '/');
  const [file, setFile] = useState<File | null>(null);
  const [src, setSrc] = useState<{ drawable: Drawable; svg: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const debouncedText = useDebouncedValue(text, 200);

  // Decode the uploaded source (SVGs are rasterized large for crisp downscaling).
  useEffect(() => {
    if (source !== 'image' || !file) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    (async () => {
      try {
        setError(null);
        const isSvg = /svg/.test(file.type) || /\.svg$/i.test(file.name);
        if (isSvg) {
          const svg = await file.text();
          const dims = svgIntrinsicSize(svg);
          const scale = 1024 / Math.max(dims.width, dims.height);
          bitmap = await rasterizeSvg(svg, Math.max(1, Math.round(dims.width * scale)), Math.max(1, Math.round(dims.height * scale)));
          if (!cancelled) setSrc({ drawable: bitmap, svg });
        } else {
          const d = await decodeImage(file);
          bitmap = d.bitmap;
          if (!cancelled) setSrc({ drawable: d.bitmap, svg: null });
        }
      } catch (e) {
        if (!cancelled) {
          setSrc(null);
          setError(errorMessage(e, 'This image could not be opened.'));
        }
      }
    })();
    return () => {
      cancelled = true;
      bitmap?.close();
    };
  }, [file, source]);

  const drawable = useMemo<Drawable | null>(() => {
    if (source === 'text') return drawLetterMark(letterMarkText(debouncedText), fg, bg, shape, weight);
    return src?.drawable ?? null;
  }, [source, debouncedText, fg, bg, shape, weight, src]);

  const solid = source === 'text' ? bg : fillBg ? imageBg : null;
  const touchBg = solid ?? '#ffffff';

  // Render every PNG output.
  useEffect(() => {
    if (!drawable) {
      setRendered([]);
      return;
    }
    let cancelled = false;
    const created: string[] = [];
    setBusy(true);
    (async () => {
      const pad = padding / 100;
      const specs: Array<{ name: string; size: number; label: string; opts: Parameters<typeof renderSquare>[2] }> = [
        { name: FAVICON_FILES.png16, size: 16, label: 'Browser tab 16', opts: { padding: pad, background: fillBg && source === 'image' ? imageBg : null } },
        { name: FAVICON_FILES.png32, size: 32, label: 'Browser tab 32', opts: { padding: pad, background: fillBg && source === 'image' ? imageBg : null } },
        { name: FAVICON_FILES.apple, size: 180, label: 'Apple touch 180', opts: { padding: source === 'text' ? 0 : Math.max(pad, 0.06), background: touchBg } },
        { name: FAVICON_FILES.android192, size: 192, label: 'Android 192', opts: { padding: pad, background: fillBg && source === 'image' ? imageBg : null } },
        { name: FAVICON_FILES.android512, size: 512, label: 'Android 512', opts: { padding: pad, background: fillBg && source === 'image' ? imageBg : null } },
        { name: FAVICON_FILES.maskable, size: 512, label: 'Maskable 512', opts: { padding: Math.max(pad, 0.12), background: touchBg } },
      ];
      const out: Rendered[] = [];
      for (const s of specs) {
        // Text marks already contain their shape: draw the background only for maskable/apple squares.
        const opts = source === 'text' && s.name !== FAVICON_FILES.maskable && s.name !== FAVICON_FILES.apple ? { padding: s.opts?.padding ?? 0 } : s.opts;
        const blob = await canvasToBlob(renderSquare(drawable, s.size, opts), 'image/png');
        const url = URL.createObjectURL(blob);
        created.push(url);
        out.push({ name: s.name, size: s.size, blob, url, label: s.label });
      }
      if (!cancelled) setRendered(out);
    })()
      .catch((e) => !cancelled && setError(errorMessage(e, 'Could not render the icons.')))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
      setTimeout(() => created.forEach((u) => URL.revokeObjectURL(u)), 0);
    };
  }, [drawable, padding, fillBg, imageBg, touchBg, source]);

  const manifest = buildManifest({ name, shortName: name.slice(0, 12), themeColor, backgroundColor: touchBg, path });
  const html = buildHtml({ path, themeColor, hasSvg: Boolean(src?.svg) && source === 'image' });

  async function downloadZip() {
    if (!drawable) return;
    setZipping(true);
    try {
      const icoSrc = source === 'text' ? drawable : renderSquare(drawable, 256, { padding: padding / 100, background: fillBg ? imageBg : null });
      const ico = await buildIco(icoSrc, [16, 32, 48]);
      const entries: Array<{ name: string; data: Blob | string }> = [
        { name: FAVICON_FILES.ico, data: ico },
        ...rendered.map((r) => ({ name: r.name, data: r.blob })),
        { name: FAVICON_FILES.manifest, data: manifest },
        { name: 'favicon-html.txt', data: html + '\n' },
      ];
      if (source === 'image' && src?.svg) entries.push({ name: FAVICON_FILES.svg, data: src.svg });
      downloadBlob(await zipBlobs(entries, 6), 'favicons.zip');
    } catch (e) {
      toast(errorMessage(e, 'Could not create the ZIP.'), 'error');
    } finally {
      setZipping(false);
    }
  }

  async function downloadIco() {
    if (!drawable) return;
    try {
      const icoSrc = source === 'text' ? drawable : renderSquare(drawable, 256, { padding: padding / 100, background: fillBg ? imageBg : null });
      downloadBlob(await buildIco(icoSrc, [16, 32, 48]), FAVICON_FILES.ico);
    } catch (e) {
      toast(errorMessage(e, 'Could not create the ICO.'), 'error');
    }
  }

  const dims = src && 'width' in src.drawable ? { w: src.drawable.width, h: src.drawable.height } : null;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Source</Label>
          <Segmented
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: 'image', label: 'Image or SVG' },
              { value: 'text', label: 'Letters' },
            ]}
          />
        </div>
        {source === 'text' ? (
          <>
            <div className="w-28">
              <Label htmlFor="fav-text">Letters</Label>
              <Input id="fav-text" value={text} maxLength={8} onChange={(e) => setText(e.target.value)} />
            </div>
            <ColorField label="Text" value={fg} onChange={setFg} />
            <ColorField label="Background" value={bg} onChange={setBg} />
            <div>
              <Label>Shape</Label>
              <Segmented
                label="Shape"
                value={shape}
                onChange={setShape}
                options={[
                  { value: 'square', label: 'Square' },
                  { value: 'rounded', label: 'Rounded' },
                  { value: 'circle', label: 'Circle' },
                ]}
              />
            </div>
            <div>
              <Label>Weight</Label>
              <Segmented
                label="Weight"
                value={weight}
                onChange={setWeight}
                options={[
                  { value: '500', label: 'Medium' },
                  { value: '700', label: 'Bold' },
                  { value: '900', label: 'Black' },
                ]}
              />
            </div>
          </>
        ) : (
          <>
            <Checkbox label="Solid background" checked={fillBg} onChange={setFillBg} className="pb-1.5" />
            {fillBg && <ColorField label="Background" value={imageBg} onChange={setImageBg} />}
          </>
        )}
        <RangeField label="Padding" className="w-full sm:w-44" value={padding} min={0} max={30} onChange={setPadding} format={(v) => `${v}%`} />
      </ToolBar>

      {source === 'image' && (
        <FileDrop
          accept={IMAGE_ACCEPT}
          onFiles={(f) => setFile(f[0])}
          icon={Star}
          compact={Boolean(file)}
          title={file ? `Replace ${file.name}` : 'Drop a square logo (SVG or PNG, ideally 512 px or larger)'}
        />
      )}
      <ErrorMessage error={error} />
      {source === 'image' && dims && Math.min(dims.w, dims.h) < 512 && !src?.svg && (
        <Alert tone="warning">The source is {dims.w}×{dims.h}. Use at least 512×512 for sharp Android and maskable icons.</Alert>
      )}
      {source === 'image' && dims && dims.w !== dims.h && <Alert tone="info">The image isn't square, so it is centered with transparent (or solid) margins.</Alert>}

      {drawable && (
        <>
          <Panel
            title="Preview"
            description="favicon.ico contains 16, 32 and 48 px images"
            actions={
              <>
                {busy && <Spinner />}
                <Button size="sm" onClick={downloadIco}>
                  favicon.ico
                </Button>
                <Button size="sm" variant="primary" icon={FileArchive} loading={zipping} disabled={rendered.length === 0} onClick={downloadZip}>
                  Download all (ZIP)
                </Button>
              </>
            }
          >
            <div className="flex flex-wrap items-end gap-4">
              {rendered.map((r) => (
                <figure key={r.name} className="flex flex-col items-center gap-1.5">
                  <div className="lk-checker flex items-center justify-center rounded-lg border border-line p-2" style={{ minWidth: 48, minHeight: 48 }}>
                    <img src={r.url} alt={r.label} width={Math.min(r.size, 128)} height={Math.min(r.size, 128)} style={{ imageRendering: r.size <= 32 ? 'pixelated' : 'auto' }} />
                  </div>
                  <figcaption className="text-center text-[11.5px] text-fg-muted">
                    {r.label}
                    <button type="button" className="block w-full font-medium text-accent-text hover:underline" onClick={() => downloadBlob(r.blob, r.name)}>
                      {r.name}
                    </button>
                  </figcaption>
                </figure>
              ))}
              {rendered[1] && (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="flex h-9 w-56 items-center gap-2 rounded-t-lg border border-b-0 border-line bg-surface-raised px-3 shadow-card">
                    <img src={rendered[1].url} alt="" width={16} height={16} />
                    <span className="truncate text-[12.5px] text-fg">{name || 'My Website'}</span>
                  </div>
                  <span className="text-[11.5px] text-fg-muted">Tab preview</span>
                </div>
              )}
            </div>
            {source === 'text' && (
              <p className="mt-3 text-[12.5px] text-fg-muted">Apple touch and maskable icons use a full square background, because iOS and Android apply their own rounded mask.</p>
            )}
          </Panel>
          <ToolBar>
            <div className="w-56">
              <Label htmlFor="fav-name">App name (manifest)</Label>
              <Input id="fav-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <ColorField label="Theme color" value={themeColor} onChange={setThemeColor} />
            <div className="w-40">
              <Label htmlFor="fav-path">Icons path</Label>
              <Input id="fav-path" value={path} onChange={(e) => setPath(e.target.value)} mono />
            </div>
          </ToolBar>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <EditorPanel title="HTML (put inside <head>)" value={html} height="200px" language="html" />
            <EditorPanel title="site.webmanifest" value={manifest} height="200px" language="json" downloadName="site.webmanifest" downloadType="application/manifest+json" />
          </div>
        </>
      )}
    </ToolStack>
  );
}
