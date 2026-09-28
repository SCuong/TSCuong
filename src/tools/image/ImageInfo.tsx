import { useState } from 'react';
import { Info } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, KeyValueList, Panel, Stat } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { useObjectUrl } from '@/lib/hooks';
import { errorMessage, formatBytes, formatNumber } from '@/lib/utils';
import { decodeImage, getContext, UNSUPPORTED_MESSAGE } from './lib/canvas';
import { FORMAT_INFO, readImageHeader, type ImageHeader } from './lib/formats';
import { aspectRatioLabel } from './lib/geometry';
import { extractPalette, type PaletteColor } from './lib/palette';
import { resample } from './lib/pipeline';
import { IMAGE_ACCEPT } from './lib/accept';

interface Info {
  file: File;
  header: ImageHeader;
  width: number | null;
  height: number | null;
  decodeError: string | null;
  palette: PaletteColor[];
  transparentPixels: boolean | null;
}

const yesNo = (v: boolean | undefined | null) => (v === undefined || v === null ? 'Unknown' : v ? 'Yes' : 'No');

export default function ImageInfo() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const url = useObjectUrl(info && !info.decodeError ? info.file : null);

  async function inspect(file: File) {
    setLoading(true);
    setError(null);
    try {
      // Animated GIF/WebP frame counts need the whole file (capped for memory).
      const whole = file.size <= 64 * 1024 * 1024;
      const bytes = new Uint8Array(await (whole ? file : file.slice(0, 1024 * 1024)).arrayBuffer());
      const header = readImageHeader(bytes);
      if (!header) throw new Error(`${UNSUPPORTED_MESSAGE} No known image signature was found in the first bytes.`);
      let width = header.width ?? null;
      let height = header.height ?? null;
      let decodeError: string | null = null;
      let palette: PaletteColor[] = [];
      let transparentPixels: boolean | null = null;
      try {
        const d = await decodeImage(file);
        width = d.width;
        height = d.height;
        const scale = Math.min(1, 200 / Math.max(d.width, d.height));
        const small = resample(d.bitmap, { width: Math.max(1, Math.round(d.width * scale)), height: Math.max(1, Math.round(d.height * scale)) });
        d.bitmap.close();
        const px = getContext(small).getImageData(0, 0, small.width, small.height).data;
        palette = extractPalette(px, 5);
        transparentPixels = false;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] < 255) {
            transparentPixels = true;
            break;
          }
        }
      } catch (e) {
        decodeError = errorMessage(e, 'This browser cannot decode the image.');
      }
      setInfo({ file, header, width, height, decodeError, palette, transparentPixels });
    } catch (e) {
      setInfo(null);
      setError(errorMessage(e, 'Could not read the file.'));
    } finally {
      setLoading(false);
    }
  }

  const h = info?.header;
  const detected = h ? FORMAT_INFO[h.format] : null;
  const ext = info?.file.name.includes('.') ? info.file.name.split('.').pop()!.toLowerCase() : '';
  const extOk =
    !h || !ext || ext === detected!.ext || (h.format === 'jpeg' && ['jpeg', 'jpe', 'jfif', 'jpg'].includes(ext)) || (h.format === 'tiff' && ext === 'tif') || (h.format === 'heic' && ext === 'heif');
  const mimeOk = !info?.file.type || !detected || info.file.type === detected.mime || (h?.format === 'ico' && info.file.type === 'image/vnd.microsoft.icon');
  const dominant = info?.palette[0];

  return (
    <ToolStack>
      <FileDrop
        accept={IMAGE_ACCEPT + ',.heic,.heif,.tif,.tiff,.jxl,.psd'}
        onFiles={(f) => void inspect(f[0])}
        icon={Info}
        compact={Boolean(info)}
        title="Drop an image to inspect"
        hint="Reads the file header on your device: format, size, bit depth, alpha, color profile, animation."
      />
      {loading && <Spinner label="Inspecting…" />}
      <ErrorMessage error={error} />
      {info && h && detected && (
        <>
          {(!extOk || !mimeOk) && (
            <Alert tone="warning" title="The file type doesn't match its name">
              The contents are {detected.label}
              {!extOk && `, but the extension is .${ext}`}
              {!mimeOk && ` (browser reported ${info.file.type})`}. Rename it to .{detected.ext} to avoid problems.
            </Alert>
          )}
          {info.decodeError && <Alert tone="warning">{info.decodeError} Header information is still shown below.</Alert>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Dimensions" value={info.width && info.height ? `${info.width} × ${info.height}` : '—'} />
            <Stat label="Megapixels" value={info.width && info.height ? formatNumber((info.width * info.height) / 1e6, 2) : '—'} />
            <Stat label="Aspect ratio" value={info.width && info.height ? aspectRatioLabel(info.width, info.height) : '—'} />
            <Stat label="File size" value={formatBytes(info.file.size)} />
          </div>
          <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_320px]">
            <Panel title="Details" bodyClassName="px-4 py-1">
              <KeyValueList
                items={[
                  { label: 'File name', value: info.file.name },
                  { label: 'Format (from contents)', value: <span className="inline-flex flex-wrap items-center gap-1.5">{detected.label}{h.detail && <Badge>{h.detail}</Badge>}</span> },
                  { label: 'MIME type', value: detected.mime },
                  { label: 'Reported by browser', value: info.file.type || '(none)' },
                  { label: 'Exact size', value: `${info.file.size.toLocaleString()} bytes` },
                  { label: 'Last modified', value: new Date(info.file.lastModified).toLocaleString() },
                  { label: 'Bit depth', value: h.bitDepth ? `${h.bitDepth} bits per channel` : h.bitsPerPixel ? `${h.bitsPerPixel} bits per pixel` : 'Unknown' },
                  { label: 'Color type', value: h.colorType ?? (h.channels ? `${h.channels} channels` : 'Unknown') },
                  { label: 'Alpha channel', value: yesNo(h.hasAlpha) },
                  { label: 'Uses transparency', value: yesNo(info.transparentPixels) },
                  { label: 'Color profile (ICC)', value: yesNo(h.hasIcc ?? false) },
                  { label: 'EXIF / XMP', value: `${yesNo(h.hasExif ?? false)} / ${yesNo(h.hasXmp ?? false)}` },
                  { label: 'Animated', value: h.animated === undefined ? 'Unknown' : h.animated ? `Yes${h.frameCount ? ` (${h.frameCount} frames)` : ''}` : 'No' },
                  ...(h.progressive !== undefined && h.format !== 'png' ? [{ label: 'Progressive', value: yesNo(h.progressive) }] : []),
                  ...(h.format === 'png' ? [{ label: 'Interlaced', value: yesNo(h.progressive) }] : []),
                ]}
              />
            </Panel>
            <div className="flex min-w-0 flex-col gap-4">
              {url && (
                <Panel title="Preview">
                  <div className="lk-checker flex justify-center overflow-hidden rounded-lg border border-line">
                    <img src={url} alt="" className="max-h-60 object-contain" />
                  </div>
                </Panel>
              )}
              {dominant && (
                <Panel title="Dominant colors">
                  <div className="flex items-center gap-3">
                    <div className="size-12 shrink-0 rounded-lg border border-line" style={{ backgroundColor: dominant.hex }} />
                    <div className="min-w-0">
                      <p className="font-mono text-[14px] font-semibold text-fg">{dominant.hex}</p>
                      <p className="text-[12.5px] text-fg-muted">{Math.round(dominant.share * 100)}% of the image</p>
                    </div>
                    <CopyButton value={dominant.hex} iconOnly className="ml-auto" />
                  </div>
                  <div className="mt-3 flex h-6 overflow-hidden rounded-md border border-line" aria-label="Color proportions">
                    {info.palette.map((c) => (
                      <div key={c.hex} title={`${c.hex} · ${Math.round(c.share * 100)}%`} style={{ backgroundColor: c.hex, flexGrow: c.share }} />
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </ToolStack>
  );
}
