import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FileArchive, LayoutGrid, X } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Input, Label, NumberInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { downloadBlob, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { canvasToBlob, checkDimensions, createCanvas, decodeImage, getContext } from './lib/canvas';
import { gridLayout, packLayout, sheetFileName, spriteCss, spriteJson } from './lib/sprite';
import { zipBlobs } from './lib/zip';
import { IMAGE_ACCEPT } from './lib/accept';

interface Sprite {
  id: number;
  name: string;
  bitmap: ImageBitmap;
  url: string;
}

type Mode = 'packed' | 'grid';
let seq = 0;

export default function SpriteSheetGenerator() {
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [mode, setMode] = useToolState<Mode>('image-sprite', 'mode', 'packed');
  const [columns, setColumns] = useToolState<number | ''>('image-sprite', 'columns', 4);
  const [padding, setPadding] = useToolState<number | ''>('image-sprite', 'padding', 2);
  const [prefix, setPrefix] = useToolState('image-sprite', 'prefix', 'icon');
  const [sheetName, setSheetName] = useToolState('image-sprite', 'sheetName', 'sprite.png');
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [png, setPng] = useState<Blob | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spritesRef = useRef(sprites);
  spritesRef.current = sprites;

  useEffect(
    () => () =>
      spritesRef.current.forEach((s) => {
        s.bitmap.close();
        URL.revokeObjectURL(s.url);
      }),
    [],
  );

  async function add(files: File[]) {
    setLoading(true);
    const errs: string[] = [];
    const added: Sprite[] = [];
    for (const f of files) {
      try {
        const d = await decodeImage(f);
        added.push({ id: ++seq, name: f.name, bitmap: d.bitmap, url: URL.createObjectURL(f) });
      } catch (e) {
        errs.push(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setSprites((s) => [...s, ...added]);
    setErrors(errs);
    setLoading(false);
  }

  function remove(id: number) {
    setSprites((list) => {
      const s = list.find((x) => x.id === id);
      if (s) {
        s.bitmap.close();
        URL.revokeObjectURL(s.url);
      }
      return list.filter((x) => x.id !== id);
    });
  }

  function move(index: number, delta: number) {
    setSprites((list) => {
      const next = [...list];
      const j = index + delta;
      if (j < 0 || j >= next.length) return list;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  const pad = typeof padding === 'number' ? Math.max(0, Math.min(256, padding)) : 0;
  const layout = useMemo(() => {
    const inputs = sprites.map((s) => ({ name: s.name, width: s.bitmap.width, height: s.bitmap.height }));
    return mode === 'grid' ? gridLayout(inputs, typeof columns === 'number' ? columns : 1, pad) : packLayout(inputs, pad);
  }, [sprites, mode, columns, pad]);

  useEffect(() => {
    const c = canvasRef.current;
    setPng(null);
    setRenderError(null);
    if (!c || sprites.length === 0 || layout.width === 0) return;
    try {
      checkDimensions(layout.width, layout.height);
    } catch (e) {
      setRenderError(errorMessage(e));
      return;
    }
    c.width = layout.width;
    c.height = layout.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    layout.items.forEach((it, i) => ctx.drawImage(sprites[i].bitmap, it.x, it.y));
    let cancelled = false;
    // Encode a copy so the preview canvas isn't blocked.
    const copy = createCanvas(c.width, c.height);
    getContext(copy).drawImage(c, 0, 0);
    canvasToBlob(copy, 'image/png').then(
      (b) => !cancelled && setPng(b),
      () => !cancelled && setRenderError('Could not encode the sprite sheet.'),
    );
    return () => {
      cancelled = true;
    };
  }, [layout, sprites]);

  const sheetFile = sheetFileName(sheetName);
  const sheetBase = sheetFile.replace(/\.png$/i, '');
  const css = sprites.length ? spriteCss(layout, prefix, sheetFile) : '';
  const json = sprites.length ? spriteJson(layout, sheetFile) : '';

  async function downloadZip() {
    if (!png) return;
    try {
      const blob = await zipBlobs(
        [
          { name: sheetFile, data: png },
          { name: `${sheetBase}.css`, data: css },
          { name: `${sheetBase}.json`, data: json },
        ],
        6,
      );
      downloadBlob(blob, `${sheetBase}.zip`);
    } catch (e) {
      toast(errorMessage(e, 'Could not create the ZIP.'), 'error');
    }
  }

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Layout</Label>
          <Segmented
            label="Layout"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'packed', label: 'Packed' },
              { value: 'grid', label: 'Grid' },
            ]}
          />
        </div>
        {mode === 'grid' && (
          <div className="w-24">
            <Label htmlFor="sp-cols">Columns</Label>
            <NumberInput id="sp-cols" value={columns} onChange={setColumns} min={1} max={100} />
          </div>
        )}
        <div className="w-24">
          <Label htmlFor="sp-pad">Padding (px)</Label>
          <NumberInput id="sp-pad" value={padding} onChange={setPadding} min={0} max={256} />
        </div>
        <div className="w-36">
          <Label htmlFor="sp-prefix">CSS class prefix</Label>
          <Input id="sp-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} mono />
        </div>
        <div className="w-44">
          <Label htmlFor="sp-name">Sheet file name</Label>
          <Input id="sp-name" value={sheetName} onChange={(e) => setSheetName(e.target.value)} mono />
        </div>
      </ToolBar>
      <FileDrop multiple accept={IMAGE_ACCEPT} onFiles={(f) => void add(f)} icon={LayoutGrid} compact={sprites.length > 0} title="Drop images (icons, frames) to combine" />
      {loading && <Spinner label="Reading images…" />}
      {errors.length > 0 && (
        <Alert tone="danger" title="Some files were skipped">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      )}
      <ErrorMessage error={renderError} />
      {sprites.length > 0 && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_1fr]">
          <Panel title={pluralize(sprites.length, 'image')} bodyClassName="p-0" actions={<Button size="sm" variant="ghost" onClick={() => sprites.forEach((s) => remove(s.id))}>Clear</Button>}>
            <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
              {sprites.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                  <div className="lk-checker flex size-8 shrink-0 items-center justify-center overflow-hidden rounded border border-line">
                    <img src={s.url} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-fg">{s.name}</p>
                    <p className="font-mono text-[11.5px] text-fg-muted">
                      {s.bitmap.width}×{s.bitmap.height}
                    </p>
                  </div>
                  <IconButton icon={ArrowUp} size="sm" label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon={ArrowDown} size="sm" label={`Move ${s.name} down`} disabled={i === sprites.length - 1} onClick={() => move(i, 1)} />
                  <IconButton icon={X} size="sm" label={`Remove ${s.name}`} onClick={() => remove(s.id)} />
                </li>
              ))}
            </ul>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title="Sprite sheet"
              description={`${layout.width} × ${layout.height} px${png ? ` · ${formatBytes(png.size)}` : ''}`}
              actions={
                <>
                  <Button size="sm" icon={Download} disabled={!png} onClick={() => png && downloadBlob(png, sheetFile)}>
                    PNG
                  </Button>
                  <Button size="sm" variant="primary" icon={FileArchive} disabled={!png} onClick={downloadZip}>
                    PNG + CSS + JSON
                  </Button>
                </>
              }
            >
              <div className="lk-checker flex max-h-[420px] items-start justify-center overflow-auto rounded-lg border border-line p-2">
                <canvas ref={canvasRef} className="block h-auto max-w-full" style={{ imageRendering: layout.width < 400 ? 'pixelated' : 'auto', width: layout.width < 160 ? layout.width * 2 : undefined }} role="img" aria-label="Sprite sheet preview" />
              </div>
            </Panel>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <EditorPanel title="CSS" value={css} language="css" height="260px" downloadName={`${sheetBase}.css`} downloadType="text/css" />
              <EditorPanel title="JSON map" value={json} language="json" height="260px" downloadName={`${sheetBase}.json`} downloadType="application/json" />
            </div>
          </div>
        </div>
      )}
    </ToolStack>
  );
}
