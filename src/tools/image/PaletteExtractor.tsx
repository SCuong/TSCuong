import { useEffect, useMemo, useState } from 'react';
import { Download, SwatchBook } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { baseName, copyText, downloadBlob } from '@/lib/utils';
import { useSingleImage } from './components/useSingleImage';
import { RangeField } from './components/controls';
import { canvasToBlob, createCanvas, getContext } from './lib/canvas';
import { formatColor, readableTextOn } from './lib/color';
import { extractPalette, paletteToCss, paletteToJson, srgbToOklab, type PaletteColor } from './lib/palette';
import { resample } from './lib/pipeline';
import { IMAGE_ACCEPT } from './lib/accept';

type Sort = 'share' | 'lightness' | 'hue';

function sortColors(colors: PaletteColor[], sort: Sort): PaletteColor[] {
  const list = [...colors];
  if (sort === 'lightness') list.sort((a, b) => srgbToOklab(...b.rgb)[0] - srgbToOklab(...a.rgb)[0]);
  if (sort === 'hue')
    list.sort((a, b) => {
      const [, a1, b1] = srgbToOklab(...a.rgb);
      const [, a2, b2] = srgbToOklab(...b.rgb);
      return Math.atan2(b1, a1) - Math.atan2(b2, a2);
    });
  return list;
}

async function swatchPng(colors: PaletteColor[]): Promise<Blob> {
  const cell = 160;
  const c = createCanvas(cell * colors.length, cell + 48);
  const ctx = getContext(c);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  colors.forEach((col, i) => {
    ctx.fillStyle = col.hex;
    ctx.fillRect(i * cell, 0, cell, cell);
    ctx.fillStyle = '#111111';
    ctx.font = '600 20px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(col.hex.toUpperCase(), i * cell + cell / 2, cell + 32);
  });
  return canvasToBlob(c, 'image/png');
}

export default function PaletteExtractor() {
  const { image, error, loading, load, clear } = useSingleImage();
  const [count, setCount] = useToolState('image-palette', 'count', 6);
  const [sort, setSort] = useToolState<Sort>('image-palette', 'sort', 'share');
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);

  useEffect(() => {
    if (!image) return setPixels(null);
    const scale = Math.min(1, 256 / Math.max(image.width, image.height));
    const small = resample(image.bitmap, { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) });
    setPixels(getContext(small).getImageData(0, 0, small.width, small.height).data);
  }, [image]);

  const palette = useMemo(() => (pixels ? extractPalette(pixels, count) : []), [pixels, count]);
  const sorted = useMemo(() => sortColors(palette, sort), [palette, sort]);
  const css = paletteToCss(sorted);
  const json = paletteToJson(sorted);
  const name = image ? baseName(image.file.name) : 'palette';

  return (
    <ToolStack>
      <ToolBar>
        <RangeField label="Colors" className="w-full sm:w-64" value={count} min={3} max={16} onChange={setCount} />
        <div>
          <Label>Order</Label>
          <Segmented
            label="Order"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'share', label: 'Most used' },
              { value: 'lightness', label: 'Lightness' },
              { value: 'hue', label: 'Hue' },
            ]}
          />
        </div>
      </ToolBar>
      {!image && <FileDrop accept={IMAGE_ACCEPT} onFiles={(f) => void load(f[0])} icon={SwatchBook} title="Drop an image to extract its palette" />}
      {loading && <Spinner label="Opening image…" />}
      <ErrorMessage error={error} />
      {image && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Panel title={image.file.name} actions={<Button size="sm" variant="ghost" onClick={clear}>Choose another</Button>}>
            <div className="lk-checker flex justify-center overflow-hidden rounded-lg border border-line">
              <img src={image.url} alt="" className="max-h-[50vh] object-contain" />
            </div>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            {sorted.length === 0 ? (
              <Panel>
                <p className="text-[13px] text-fg-muted">The image is fully transparent, so there are no colors to extract.</p>
              </Panel>
            ) : (
              <>
                <Panel title={`Palette · ${sorted.length} colors`} description="k-means clustering in the perceptual OKLab color space">
                  <div className="flex h-10 overflow-hidden rounded-lg border border-line" role="img" aria-label="Color proportions">
                    {sorted.map((c) => (
                      <div key={c.hex} style={{ backgroundColor: c.hex, flexGrow: c.share }} title={`${c.hex} · ${(c.share * 100).toFixed(1)}%`} />
                    ))}
                  </div>
                  <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {sorted.map((c) => {
                      const f = formatColor(...c.rgb);
                      return (
                        <li key={c.hex} className="overflow-hidden rounded-lg border border-line bg-surface-sunken">
                          <button
                            type="button"
                            className="flex h-16 w-full items-end justify-between p-2 text-left font-mono text-[11.5px]"
                            style={{ backgroundColor: c.hex, color: readableTextOn(...c.rgb) }}
                            onClick={() => {
                              void copyText(c.hex).then((ok) => toast(ok ? `Copied ${c.hex}` : 'Copy failed.', ok ? 'success' : 'error'));
                            }}
                            aria-label={`Copy ${c.hex}`}
                          >
                            <span>{(c.share * 100).toFixed(1)}%</span>
                          </button>
                          <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                            <div className="min-w-0 font-mono text-[12px]">
                              <p className="font-semibold text-fg">{c.hex}</p>
                              <p className="truncate text-fg-muted">{f.rgb.replace('rgb', '')}</p>
                            </div>
                            <CopyButton value={c.hex} iconOnly label={`Copy ${c.hex}`} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
                <Panel title="Export" bodyClassName="p-4">
                  <pre className="max-h-48 overflow-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12.5px] text-fg">{css}</pre>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <CopyButton value={css} label="Copy CSS" />
                    <DownloadButton data={css} filename={`${name}-palette.css`} type="text/css" label="CSS" />
                    <CopyButton value={json} label="Copy JSON" />
                    <DownloadButton data={json} filename={`${name}-palette.json`} type="application/json" label="JSON" />
                    <Button
                      size="sm"
                      icon={Download}
                      onClick={async () => {
                        try {
                          downloadBlob(await swatchPng(sorted), `${name}-palette.png`);
                        } catch {
                          toast('Could not render the swatch image.', 'error');
                        }
                      }}
                    >
                      PNG swatch
                    </Button>
                  </div>
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
    </ToolStack>
  );
}
