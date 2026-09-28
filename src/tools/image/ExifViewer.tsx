import { useMemo, useState } from 'react';
import { Camera, Download, ExternalLink, FileSearch, MapPin } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button } from '@/components/ui/Button';
import { ErrorMessage, Alert } from '@/components/ui/Alert';
import { Badge, KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Input } from '@/components/ui/Field';
import { useObjectUrl } from '@/lib/hooks';
import { baseName, downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import { readHeader, UNSUPPORTED_MESSAGE } from './lib/canvas';
import { readMetadata, summarizeMetadata, formatCoord, osmUrl, type MetaGroups } from './lib/exif';
import { GROUP_LABELS, groupForDisplay, metadataToJson } from './lib/exifGroups';
import { FORMAT_INFO, type ImageHeader } from './lib/formats';
import { IMAGE_ACCEPT } from './lib/accept';

interface Loaded {
  file: File;
  header: ImageHeader;
  groups: MetaGroups;
  thumbnail: Blob | null;
}

export default function ExifViewer() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const previewUrl = useObjectUrl(data?.file);
  const thumbUrl = useObjectUrl(data?.thumbnail);

  async function open(file: File) {
    setLoading(true);
    setError(null);
    setFilter('');
    try {
      const header = await readHeader(file);
      if (!header) throw new Error(UNSUPPORTED_MESSAGE);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const groups = await readMetadata(bytes);
      let thumbnail: Blob | null = null;
      try {
        const exifr = await import('exifr');
        const thumb = await (exifr.thumbnail ?? exifr.default.thumbnail)(bytes);
        if (thumb && thumb.length > 0) thumbnail = new Blob([new Uint8Array(thumb)], { type: 'image/jpeg' });
      } catch {
        // No embedded thumbnail.
      }
      setData({ file, header, groups, thumbnail });
    } catch (e) {
      setData(null);
      setError(errorMessage(e, 'Could not read this file.'));
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => (data ? summarizeMetadata(data.groups) : null), [data]);
  const sections = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    return groupForDisplay(data.groups)
      .map((s) => ({ ...s, rows: q ? s.rows.filter((r) => r.label.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)) : s.rows }))
      .filter((s) => s.rows.length);
  }, [data, filter]);
  const json = useMemo(() => (data ? metadataToJson(data.groups) : ''), [data]);
  const empty = data && Object.keys(data.groups).filter((k) => k !== 'jfif' && k !== 'ihdr').length === 0;

  return (
    <ToolStack>
      <FileDrop
        accept={IMAGE_ACCEPT + ',.heic,.heif,.tif,.tiff'}
        onFiles={(f) => void open(f[0])}
        icon={FileSearch}
        compact={Boolean(data)}
        title="Drop a photo to read its EXIF data"
        hint="JPEG, PNG, WebP, HEIC, TIFF and AVIF. Read on this device, never uploaded."
      />
      {loading && <Spinner label="Reading metadata…" />}
      <ErrorMessage error={error} />
      {data && summary && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title={data.file.name} description={`${FORMAT_INFO[data.header.format].label} · ${formatBytes(data.file.size)}`}>
              {previewUrl && ['jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(data.header.format) && (
                <div className="lk-checker mb-3 flex justify-center overflow-hidden rounded-lg border border-line">
                  <img src={previewUrl} alt="" className="max-h-56 object-contain" />
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-fg-muted">Camera</dt>
                <dd className="min-w-0 break-words text-fg">{summary.camera ?? '—'}</dd>
                <dt className="text-fg-muted">Taken</dt>
                <dd className="min-w-0 break-words text-fg">{summary.date ?? '—'}</dd>
                <dt className="text-fg-muted">Tags</dt>
                <dd className="text-fg tabular-nums">{summary.total}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <DownloadButton data={json} filename={`${baseName(data.file.name)}-metadata.json`} type="application/json" label="JSON" />
                <CopyButton value={json} label="Copy JSON" />
              </div>
            </Panel>
            {summary.gps && (
              <Panel title="Location" actions={<Badge tone="warning">Contains GPS</Badge>}>
                <p className="flex items-start gap-1.5 font-mono text-[13px] text-fg">
                  <MapPin size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                  {formatCoord(summary.gps.latitude, summary.gps.longitude)}
                </p>
                <p className="mt-1 font-mono text-[12px] text-fg-muted">
                  {summary.gps.latitude.toFixed(6)}, {summary.gps.longitude.toFixed(6)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton value={`${summary.gps.latitude.toFixed(6)}, ${summary.gps.longitude.toFixed(6)}`} label="Copy coordinates" />
                  <Button
                    size="sm"
                    icon={ExternalLink}
                    onClick={() => window.open(osmUrl(summary.gps!.latitude, summary.gps!.longitude), '_blank', 'noopener,noreferrer')}
                  >
                    Open in OpenStreetMap
                  </Button>
                </div>
                <p className="mt-2 text-[12px] text-fg-muted">External site: the coordinates are sent to openstreetmap.org only if you click.</p>
              </Panel>
            )}
            {data.thumbnail && thumbUrl && (
              <Panel title="Embedded thumbnail" description={formatBytes(data.thumbnail.size)}>
                <div className="flex justify-center">
                  <img src={thumbUrl} alt="Embedded EXIF thumbnail" className="max-h-40 rounded border border-line" />
                </div>
                <Button size="sm" icon={Download} className="mt-3" onClick={() => downloadBlob(data.thumbnail!, `${baseName(data.file.name)}-thumbnail.jpg`)}>
                  Download thumbnail
                </Button>
                <p className="mt-2 text-[12px] text-fg-muted">Thumbnails can show the original, uncropped photo.</p>
              </Panel>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {empty ? (
              <Panel>
                <EmptyState icon={Camera} title="No metadata found">
                  This file has no EXIF, GPS, XMP, IPTC or ICC data. Screenshots and images saved by editors or social networks are often stripped.
                </EmptyState>
              </Panel>
            ) : (
              <>
                <Input placeholder="Filter tags…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tags" />
                {sections.length === 0 && <Alert tone="info">No tags match “{filter}”.</Alert>}
                {sections.map((s) => (
                  <Panel key={s.id} title={GROUP_LABELS[s.id]} actions={<Badge>{s.rows.length}</Badge>} bodyClassName="px-4 py-1">
                    <KeyValueList items={s.rows.map((r) => ({ key: r.key, label: r.label, value: r.value }))} />
                  </Panel>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </ToolStack>
  );
}
