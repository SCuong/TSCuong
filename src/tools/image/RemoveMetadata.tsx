import { useCallback } from 'react';
import { CircleCheck, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { withExtension } from '@/lib/utils';
import { BatchFileList } from './components/BatchFileList';
import { useImageBatch, type BatchItem } from './components/useImageBatch';
import { useImagePool } from './components/useImagePool';
import { readHeader, UNSUPPORTED_MESSAGE } from './lib/canvas';
import { readMetadata, summarizeMetadata, formatCoord, type MetaSummary } from './lib/exif';
import { stripJpeg, stripPng, stripWebp, type StripResult } from './lib/metadata';
import { IMAGE_ACCEPT } from './lib/accept';

interface Report {
  before: MetaSummary;
  after: MetaSummary;
  removed: string[];
  kept: string[];
  method: 'lossless' | 'reencoded';
}

function describe(s: MetaSummary): string[] {
  const out: string[] = [];
  if (s.exifTags) out.push(`EXIF (${s.exifTags} tag${s.exifTags === 1 ? '' : 's'})`);
  if (s.gps) out.push('GPS location');
  if (s.hasXmp) out.push('XMP');
  if (s.hasIptc) out.push('IPTC');
  if (s.hasIcc) out.push('ICC profile');
  return out;
}

function ReportView({ item }: { item: BatchItem }) {
  const r = item.output?.data as Report | undefined;
  if (!r) return null;
  const found = describe(r.before);
  const orientationKept = r.kept.some((k) => k.startsWith('Orientation'));
  const remaining = describe({ ...r.after, exifTags: orientationKept ? Math.max(0, r.after.exifTags - 1) : r.after.exifTags }).filter(
    (x) => x !== 'ICC profile',
  );
  return (
    <div className="mt-1.5 space-y-1 text-[12px]">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-fg-muted">Found:</span>
        {found.length ? found.map((f) => <Badge key={f}>{f}</Badge>) : <span className="text-fg-secondary">no EXIF, GPS, XMP or IPTC</span>}
      </div>
      {r.before.gps && (
        <p className="flex items-center gap-1 text-warning">
          <MapPin size={12} aria-hidden /> Location was {formatCoord(r.before.gps.latitude, r.before.gps.longitude)}
          {r.before.camera ? ` · ${r.before.camera}` : ''}
        </p>
      )}
      {r.removed.length > 0 && (
        <p className="text-fg-secondary">
          <span className="text-fg-muted">Removed:</span> {r.removed.join(', ')}
        </p>
      )}
      {r.kept.length > 0 && (
        <p className="text-fg-secondary">
          <span className="text-fg-muted">Kept:</span> {r.kept.join(', ')}
        </p>
      )}
      {remaining.length === 0 && !r.after.gps ? (
        <p className="flex items-center gap-1 text-success">
          <CircleCheck size={12} aria-hidden /> Verified: no EXIF, GPS, XMP or IPTC left
          {r.method === 'lossless' ? ' · pixels untouched (lossless)' : ' · re-encoded as PNG'}
        </p>
      ) : (
        <p className="flex items-center gap-1 text-warning">
          <TriangleAlert size={12} aria-hidden /> Still present: {remaining.join(', ')}
        </p>
      )}
    </div>
  );
}

export default function RemoveMetadata() {
  const [keepIcc, setKeepIcc] = useToolState('image-strip-metadata', 'keepIcc', true);
  const [keepOrientation, setKeepOrientation] = useToolState('image-strip-metadata', 'keepOrientation', true);
  const pool = useImagePool();

  const processor = useCallback(
    async (file: File, signal: AbortSignal) => {
      const header = await readHeader(file);
      if (!header) throw new Error(UNSUPPORTED_MESSAGE);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const before = summarizeMetadata(await readMetadata(bytes));
      const opts = { keepIcc, keepOrientation };
      let result: StripResult | null = null;
      if (header.format === 'jpeg') result = stripJpeg(bytes, opts);
      else if (header.format === 'png') result = stripPng(bytes, opts);
      else if (header.format === 'webp') result = stripWebp(bytes, opts);

      let blob: Blob;
      let name = file.name;
      let method: Report['method'] = 'lossless';
      let removed: string[];
      let kept: string[] = [];
      if (result) {
        blob = new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: header.mime });
        removed = result.removed;
        kept = result.kept;
      } else {
        const r = await pool.run(file, { output: { format: 'png' } }, signal);
        blob = r.blob;
        name = withExtension(file.name, 'png');
        method = 'reencoded';
        removed = ['All metadata (image re-encoded)'];
      }
      const after = summarizeMetadata(await readMetadata(new Uint8Array(await blob.arrayBuffer())));
      const report: Report = { before, after, removed, kept, method };
      return {
        blob,
        name,
        width: header.width,
        height: header.height,
        data: report,
        note: removed.length === 0 && method === 'lossless' ? 'No metadata to remove: the file is already clean.' : undefined,
      };
    },
    [pool, keepIcc, keepOrientation],
  );

  const batch = useImageBatch(processor, `${keepIcc}|${keepOrientation}`);

  return (
    <ToolStack>
      <ToolBar>
        <Checkbox
          label="Keep color profile (ICC)"
          description="Recommended: removing it can shift colors. It contains no personal data."
          checked={keepIcc}
          onChange={setKeepIcc}
        />
        <Checkbox
          label="Keep orientation"
          description="Keeps only the rotation flag so photos don't appear sideways."
          checked={keepOrientation}
          onChange={setKeepOrientation}
        />
      </ToolBar>
      <FileDrop
        multiple
        accept={IMAGE_ACCEPT}
        onFiles={batch.addFiles}
        icon={ShieldCheck}
        compact={batch.items.length > 0}
        title="Drop photos to remove EXIF, GPS and other metadata"
        hint="JPEG, PNG and WebP are cleaned losslessly (pixels untouched). Other formats are re-encoded as PNG. Nothing is uploaded."
      />
      <BatchFileList
        items={batch.items}
        onRemove={batch.remove}
        onClear={batch.clear}
        onCancel={batch.cancel}
        onRetry={batch.retry}
        running={batch.running}
        progress={batch.progress}
        zipName="clean-images.zip"
        extra={(it) => <ReportView item={it} />}
      />
    </ToolStack>
  );
}
