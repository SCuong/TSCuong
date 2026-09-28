import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { DownloadButton } from '@/components/ui/Actions';
import { EditorPanel, SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { RangeField } from './components/controls';
import { SvgPreview, type PreviewBg } from './components/SvgPreview';
import { analyzeSvg } from './lib/svg';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="112" height="112" rx="28" fill="url(#g)"/>
  <path d="M40 66l16 16 32-36" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

export default function SvgEditor() {
  const [code, setCode] = useToolState('svg-editor', 'code', '');
  const [bg, setBg] = useState<PreviewBg>('checker');
  const [zoom, setZoom] = useState(100);
  const debounced = useDebouncedValue(code, 150);
  const info = useMemo(() => (debounced.trim() ? analyzeSvg(debounced) : null), [debounced]);

  return (
    <ToolStack>
      <SplitPanes>
        <EditorPanel
          title="SVG code"
          value={code}
          onChange={setCode}
          language="xml"
          placeholder="Paste SVG markup or open a .svg file…"
          sample={SAMPLE}
          fileAccept=".svg,image/svg+xml"
          invalid={Boolean(info && !info.ok)}
          height="520px"
          actions={<DownloadButton data={code} filename="image.svg" type="image/svg+xml" label="Save" variant="ghost" />}
          footer={code ? <span>{formatBytes(new Blob([code]).size)}</span> : undefined}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Preview"
            description="Rendered as an image: scripts never run"
            actions={
              <Segmented
                label="Preview background"
                size="sm"
                value={bg}
                onChange={setBg}
                options={[
                  { value: 'checker', label: 'Checker' },
                  { value: 'light', label: 'White' },
                  { value: 'dark', label: 'Black' },
                ]}
              />
            }
          >
            {!info ? (
              <EmptyState title="Nothing to preview">Paste SVG code, open a file or load the sample.</EmptyState>
            ) : info.ok ? (
              <>
                <div className="overflow-auto">
                  <div style={{ width: `${zoom}%`, minWidth: '100%' }}>
                    <SvgPreview svg={debounced} background={bg} maxHeight={zoom > 100 ? 4000 : 360} />
                  </div>
                </div>
                <RangeField label="Zoom" className="mt-3" value={zoom} min={25} max={400} step={25} onChange={setZoom} format={(v) => `${v}%`} />
              </>
            ) : (
              <ErrorMessage error={info.error} title="Invalid SVG" />
            )}
          </Panel>
          {info?.ok && (
            <Panel title="Document" bodyClassName="px-4 py-1">
              <KeyValueList
                items={[
                  { label: 'width', value: info.width ?? '(not set)' },
                  { label: 'height', value: info.height ?? '(not set)' },
                  { label: 'viewBox', value: info.viewBox ?? '(not set)' },
                  { label: 'Rendered size', value: info.size ? `${Math.round(info.size.width * 100) / 100} × ${Math.round(info.size.height * 100) / 100} px` : 'Unknown (defaults to 300 × 150)' },
                  { label: 'Elements', value: info.elements },
                ]}
              />
            </Panel>
          )}
          {info?.ok &&
            (info.warnings.length ? (
              <Alert tone="warning" title={`${info.warnings.length} issue${info.warnings.length > 1 ? 's' : ''} found`}>
                <ul className="list-disc pl-4">
                  {info.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="success">Valid SVG with a namespace, viewBox and size.</Alert>
            ))}
          {info && !info.ok && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
              <TriangleAlert size={13} aria-hidden /> Fix the markup to see the preview.
            </p>
          )}
        </div>
      </SplitPanes>
    </ToolStack>
  );
}
