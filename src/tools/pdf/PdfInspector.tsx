import { useEffect, useState, type ReactNode } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { CopyButton } from '@/components/ui/Actions';
import { Badge, KeyValueList, Panel, Stat } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { formatBytes, formatNumber, pluralize } from '@/lib/utils';
import { headerVersion, isLinearized } from './lib/bytes';
import { parsePdfDate } from './lib/metadata';
import { describeSize, groupSizes, orientation, type PageSizeInfo } from './lib/pageSizes';
import { formatPageList } from './lib/ranges';
import { describePermissions, permissionList } from './lib/permissions';
import type { StructureInfo } from './lib/ops';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { toPdfError } from './lib/errors';
import { PdfInput } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';

export default function PdfInspector() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to inspect">
        {(pdf) => <Inspector key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

interface Report {
  version: string | null;
  linearized: boolean;
  info: Record<string, unknown>;
  hasXmp: boolean;
  pages: PageSizeInfo[];
  annotations: Record<string, number>;
  outlineItems: number;
  attachments: Array<{ name: string; size: number }>;
  formFields: number;
  acroForm: boolean;
  xfa: boolean;
  signatures: boolean;
  pageLabels: boolean;
  permissions: number[] | null;
  structure: StructureInfo | null;
  structureError: string | null;
}

function countOutline(items: Array<{ items?: unknown[] }> | null): number {
  if (!items) return 0;
  let n = 0;
  const stack = [...items];
  while (stack.length) {
    const it = stack.pop() as { items?: Array<{ items?: unknown[] }> };
    n++;
    if (it.items?.length) stack.push(...it.items);
  }
  return n;
}

function Inspector({ pdf }: { pdf: LoadedPdf }) {
  const [report, setReport] = useState<Report | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Terminates the structure worker if the user leaves before the analysis finishes.
    const ctrl = new AbortController();
    (async () => {
      const doc = pdf.doc;
      const structurePromise = runPdfOp('inspectStructure', { bytes: pdf.bytes }, { signal: ctrl.signal }).then(
        (s) => ({ s, e: null as string | null }),
        (e: unknown) => ({ s: null, e: toPdfError(e).message }),
      );
      const [meta, outline, attachments, fields, labels, permissions] = await Promise.all([
        doc.getMetadata().catch(() => null),
        doc.getOutline().catch(() => null),
        doc.getAttachments().catch(() => null),
        doc.getFieldObjects().catch(() => null),
        doc.getPageLabels().catch(() => null),
        doc.getPermissions().catch(() => null),
      ]);
      const pages: PageSizeInfo[] = [];
      const annotations: Record<string, number> = {};
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        pages.push({ page: i, width: vp.width, height: vp.height, rotation: page.rotate });
        try {
          for (const a of await page.getAnnotations()) {
            const type = String((a as { subtype?: string }).subtype ?? 'Unknown');
            annotations[type] = (annotations[type] ?? 0) + 1;
          }
        } catch {
          /* ignore broken annotations */
        }
        page.cleanup();
        if (!alive) return;
        if (i % 10 === 0) setProgress(i / doc.numPages);
      }
      const structure = await structurePromise;
      const info = (meta?.info ?? {}) as Record<string, unknown>;
      if (!alive) return;
      setReport({
        version: headerVersion(pdf.bytes),
        linearized: isLinearized(pdf.bytes),
        info,
        hasXmp: Boolean(meta?.metadata),
        pages,
        annotations,
        outlineItems: countOutline(outline as Array<{ items?: unknown[] }> | null),
        attachments: (attachments instanceof Map ? [...attachments.values()] : Object.values((attachments ?? {}) as object)).map(
          (a: { filename?: string; content?: Uint8Array | null }) => ({ name: a.filename ?? 'attachment', size: a.content?.byteLength ?? -1 }),
        ),
        formFields: fields ? Object.keys(fields).length : 0,
        acroForm: Boolean(info.IsAcroFormPresent),
        xfa: Boolean(info.IsXFAPresent),
        signatures: Boolean(info.IsSignaturesPresent),
        pageLabels: Boolean(labels),
        permissions: permissionList(permissions),
        structure: structure.s,
        structureError: structure.e,
      });
    })().catch((e: unknown) => alive && setError(toPdfError(e).message));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [pdf]);

  if (error) return <Alert tone="danger" title="Could not analyze this PDF">{error}</Alert>;
  if (!report) {
    return (
      <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <ProgressBar value={progress || null} label="Analyzing the document…" />
      </div>
    );
  }

  const info = report.info;
  const str = (k: string) => (typeof info[k] === 'string' && (info[k] as string).trim() ? (info[k] as string) : null);
  const date = (k: string) => {
    const raw = str(k);
    if (!raw) return null;
    const d = parsePdfDate(raw);
    return d ? d.toLocaleString() : raw;
  };
  const groups = groupSizes(report.pages);
  const annotationTotal = Object.values(report.annotations).reduce((a, b) => a + b, 0);
  const version = report.structure?.catalogVersion && report.structure.catalogVersion > (report.version ?? '') ? report.structure.catalogVersion : report.version;
  const yesNo = (v: boolean, detail?: ReactNode) => (v ? <span>Yes{detail ? <span className="text-fg-muted"> · {detail}</span> : null}</span> : <span className="text-fg-muted">No</span>);

  const json = () =>
    JSON.stringify(
      {
        file: pdf.file.name,
        size: pdf.file.size,
        version,
        pages: report.pages.length,
        encrypted: pdf.encrypted,
        linearized: report.linearized,
        info: Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v === 'string' || typeof v === 'boolean')),
        pageSizes: report.pages,
        fonts: report.structure?.fonts ?? [],
        annotations: report.annotations,
        attachments: report.attachments,
        formFields: report.formFields,
        outlineItems: report.outlineItems,
      },
      null,
      2,
    );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pages" value={formatNumber(report.pages.length, 0)} />
        <Stat label="PDF version" value={version ?? 'Unknown'} />
        <Stat label="File size" value={formatBytes(pdf.file.size)} />
        <Stat label="Encrypted" value={pdf.encrypted ? 'Yes' : 'No'} />
      </div>
      {report.structureError && <Alert tone="warning">Some structural details could not be read: {report.structureError}</Alert>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="Document information" actions={<CopyButton value={json} label="Copy report (JSON)" />}>
          <KeyValueList
            mono={false}
            items={[
              { label: 'Title', value: str('Title') ?? <Muted /> },
              { label: 'Author', value: str('Author') ?? <Muted /> },
              { label: 'Subject', value: str('Subject') ?? <Muted /> },
              { label: 'Keywords', value: str('Keywords') ?? <Muted /> },
              { label: 'Creator', value: str('Creator') ?? <Muted /> },
              { label: 'Producer', value: str('Producer') ?? <Muted /> },
              { label: 'Created', value: date('CreationDate') ?? <Muted /> },
              { label: 'Modified', value: date('ModDate') ?? <Muted /> },
              { label: 'XMP metadata', value: yesNo(report.hasXmp) },
            ]}
          />
        </Panel>
        <Panel title="Structure">
          <KeyValueList
            mono={false}
            items={[
              { label: 'Encryption', value: pdf.encrypted ? <span>{String(info.EncryptFilterName ?? 'Yes')}{pdf.password ? ' · open password' : ' · permissions only'}</span> : <span className="text-fg-muted">None</span> },
              ...(report.permissions
                ? [
                    {
                      label: 'Allowed',
                      value: describePermissions(report.permissions),
                    },
                  ]
                : []),
              { label: 'Fast web view', value: yesNo(report.linearized, 'linearized') },
              { label: 'Tagged (accessible)', value: yesNo(Boolean(report.structure?.tagged)) },
              { label: 'Form', value: yesNo(report.acroForm || report.xfa, [report.formFields ? pluralize(report.formFields, 'field') : null, report.xfa ? 'XFA' : null].filter(Boolean).join(', ') || undefined) },
              { label: 'Digital signatures', value: yesNo(report.signatures) },
              { label: 'Annotations', value: annotationTotal ? `${formatNumber(annotationTotal, 0)} (${Object.entries(report.annotations).map(([k, v]) => `${k} ${v}`).join(', ')})` : <Muted text="None" /> },
              { label: 'Bookmarks', value: report.outlineItems ? pluralize(report.outlineItems, 'item') : <Muted text="None" /> },
              { label: 'Attachments', value: report.attachments.length ? report.attachments.map((a) => (a.size >= 0 ? `${a.name} (${formatBytes(a.size)})` : a.name)).join(', ') : <Muted text="None" /> },
              { label: 'JavaScript', value: yesNo(Boolean(report.structure?.hasJavaScript)) },
              { label: 'Page labels', value: yesNo(report.pageLabels) },
              ...(report.structure ? [{ label: 'Objects', value: formatNumber(report.structure.objectCount, 0) }] : []),
            ]}
          />
        </Panel>
      </div>

      <Panel title="Page sizes" description={groups.length === 1 ? 'All pages have the same size.' : `${groups.length} different sizes`} bodyClassName="p-0">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Page sizes table">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-fg-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Pages</th>
                <th className="px-4 py-2 font-medium">Points</th>
                <th className="px-4 py-2 font-medium">Millimetres</th>
                <th className="px-4 py-2 font-medium">Inches</th>
                <th className="px-4 py-2 font-medium">Orientation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {groups.map((g) => {
                const d = describeSize(g.width, g.height);
                return (
                  <tr key={`${g.width}x${g.height}r${g.rotation}`}>
                    <td className="max-w-56 px-4 py-2 font-mono text-[12.5px] break-words text-fg">{formatPageList(g.pages)}</td>
                    <td className="px-4 py-2 font-mono text-[12.5px] whitespace-nowrap">{d.pt}</td>
                    <td className="px-4 py-2 font-mono text-[12.5px] whitespace-nowrap">{d.mm}</td>
                    <td className="px-4 py-2 font-mono text-[12.5px] whitespace-nowrap">{d.inches}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="capitalize">{orientation(g.width, g.height)}</span>
                      {d.paper && <Badge className="ml-2">{d.paper}</Badge>}
                      {g.rotation ? <Badge className="ml-1">rotated {g.rotation}°</Badge> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`Fonts${report.structure ? ` (${report.structure.fonts.length})` : ''}`} bodyClassName="p-0">
        {!report.structure ? (
          <p className="px-4 py-3 text-[13px] text-fg-muted">Font information is unavailable for this file.</p>
        ) : report.structure.fonts.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-fg-muted">No fonts are used (the document may contain only images, e.g. a scan).</p>
        ) : (
          <div className="max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Fonts table">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="sticky top-0 border-b border-line bg-surface text-[12px] text-fg-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Font</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Embedded</th>
                  <th className="px-4 py-2 font-medium">Pages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.structure.fonts.map((f, i) => (
                  <tr key={`${f.name}-${f.type}-${i}`}>
                    <td className="px-4 py-2 font-mono text-[12.5px] break-all text-fg">{f.name}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{f.type}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {f.embedded ? <Badge tone="success">{f.subset ? 'Subset' : 'Yes'}</Badge> : <Badge tone="warning">No</Badge>}
                    </td>
                    <td className="max-w-48 px-4 py-2 font-mono text-[12px] break-words text-fg-muted">{formatPageList(f.pages)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Muted({ text = 'Not set' }: { text?: string }) {
  return <span className="text-fg-muted">{text}</span>;
}
