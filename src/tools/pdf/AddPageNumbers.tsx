import { useId, useMemo, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input, Label, NumberInput, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { cn, pluralize } from '@/lib/utils';
import { anchorCenter, mmToPt } from './lib/geometry';
import { formatPageNumber, hasPageToken, type NumberPosition } from './lib/ops';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { PreviewPage } from './components/PreviewPage';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { hexToRgb01 } from './lib/color';
import { unsupportedCharacters } from './lib/winansi';
import { unsupportedCharacterMessage } from './lib/errors';
import { useKeyedResult } from './components/useKeyedResult';
import { PositionGrid } from './components/PositionGrid';

const FORMATS = ['{n}', 'Page {n}', 'Page {n} of {total}', '{n} / {total}', '- {n} -'] as const;
const POSITIONS: Array<{ value: NumberPosition; label: string }> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export default function AddPageNumbers() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to number its pages">
        {(pdf) => <NumbersWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function NumbersWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [position, setPosition] = useState<NumberPosition>('bottom-center');
  const [preset, setPreset] = useState<string>('Page {n} of {total}');
  const [custom, setCustom] = useState('{n}');
  const [fontSize, setFontSize] = useState<number | ''>(10);
  const [marginMm, setMarginMm] = useState<number | ''>(10);
  const [start, setStart] = useState<number | ''>(1);
  const [skipFirst, setSkipFirst] = useState(false);
  const [color, setColor] = useState('#333333');
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'draw');
  const ids = { format: useId(), custom: useId(), size: useId(), margin: useId(), start: useId(), color: useId() };

  const format = preset === 'custom' ? custom : preset;
  const unsupported = unsupportedCharacters(format);
  const pages = useMemo(() => (skipFirst ? scope.pages.filter((p) => p !== 0) : scope.pages), [scope.pages, skipFirst]);

  const errors = [
    fontSize === '' || fontSize < 4 || fontSize > 144 ? 'Font size must be between 4 and 144 pt.' : null,
    marginMm === '' || marginMm < 0 || marginMm > 100 ? 'Margin must be between 0 and 100 mm.' : null,
    start === '' || !Number.isInteger(start) || start < 0 ? 'The start number must be a whole number (0 or more).' : null,
    !hasPageToken(format) ? 'The format must contain {n} (or a zero-padded {n:6}).' : null,
    format.length > 60 ? 'The format is too long.' : null,
    unsupported.length ? unsupportedCharacterMessage(unsupported) : null,
  ].filter(Boolean) as string[];

  const firstNumbered = pages[0];
  const last = (start === '' ? 1 : start) + pages.length - 1;
  const sampleText = formatPageNumber(format, start === '' ? 1 : start, last);
  const inputKey = JSON.stringify([pages, position, format, fontSize, marginMm, start, color]);
  const result = useKeyedResult<OutputFile>(inputKey);

  async function run() {
    const key = inputKey;
    result.clear();
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp(
        'addPageNumbers',
        {
          bytes: pdf.bytes,
          pages,
          position,
          format,
          fontSize: Number(fontSize),
          margin: mmToPt(Number(marginMm)),
          startNumber: Number(start),
          color: hexToRgb01(color),
          ignoreEncryption: gate.ignoreEncryption,
        },
        { signal, onProgress: progress },
      ),
    );
    if (bytes) result.set(key, { name: outputName(pdf.file.name, 'numbered'), data: pdfBlob(bytes), type: 'application/pdf' });
  }

  return (
    <>
      {gate.notice}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Numbering">
          <div className="flex flex-col gap-4">
            <div>
              <Label>Position</Label>
              <PositionGrid
                label="Position"
                value={position}
                onChange={setPosition}
                options={POSITIONS}
                className="max-w-xs"
                cellClassName={(v) =>
                  cn(
                    'h-10 px-2',
                    v.startsWith('bottom') ? 'items-end pb-1.5' : 'items-start pt-1.5',
                    v.endsWith('left') ? 'justify-start' : v.endsWith('right') ? 'justify-end' : 'justify-center',
                  )
                }
                indicator={(selected) => <span className={cn('h-1.5 w-4 rounded-full', selected ? 'bg-accent' : 'bg-fg-muted/50')} />}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={ids.format}>Format</Label>
                <Select id={ids.format} value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {formatPageNumber(f, 1, pdf.pageCount)}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </Select>
              </div>
              {preset === 'custom' && (
                <div>
                  <Label htmlFor={ids.custom}>Custom format</Label>
                  <Input id={ids.custom} mono value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Page {n} of {total}" />
                  <p className="mt-1.5 text-[12.5px] text-fg-muted">
                    <code>{'{n}'}</code> = number, <code>{'{total}'}</code> = last number, <code>{'{n:6}'}</code> = zero-padded (Bates, e.g. <code>{'ABC{n:6}'}</code> → ABC000001)
                  </p>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor={ids.size}>Font size (pt)</Label>
                <NumberInput id={ids.size} min={4} max={144} value={fontSize} onChange={setFontSize} />
              </div>
              <div>
                <Label htmlFor={ids.margin}>Margin (mm)</Label>
                <NumberInput id={ids.margin} min={0} max={100} step={1} value={marginMm} onChange={setMarginMm} />
              </div>
              <div>
                <Label htmlFor={ids.start}>Start at</Label>
                <NumberInput id={ids.start} min={0} step={1} value={start} onChange={setStart} />
              </div>
              <div>
                <Label htmlFor={ids.color}>Color</Label>
                <input
                  id={ids.color}
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-full cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
                />
              </div>
            </div>
            <PageScopeControl scope={scope} modes={['all', 'range']} label="Pages to number" />
            <Checkbox
              label="Skip the first page"
              description="Useful for a cover page. Numbering starts on the next numbered page."
              checked={skipFirst}
              onChange={setSkipFirst}
            />
            {errors.map((e) => (
              <ErrorMessage key={e} error={e} />
            ))}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button
                variant="primary"
                icon={ListOrdered}
                disabled={!gate.ok || pages.length === 0 || errors.length > 0 || Boolean(scope.error) || job.running}
                loading={job.running}
                onClick={() => void run()}
              >
                Add page numbers
              </Button>
              <span className="text-[13px] text-fg-muted">
                {pages.length ? `${pluralize(pages.length, 'page')} numbered ${start === '' ? '' : `${start}–${last}`}` : 'No pages selected'}
              </span>
            </div>
          </div>
        </Panel>
        <Panel title="Preview" description={firstNumbered !== undefined ? `Page ${firstNumbered + 1}` : undefined} className="h-fit">
          {firstNumbered !== undefined && errors.length === 0 ? (
            <div className="flex justify-center">
              <PreviewPage doc={pdf.doc} pageIndex={firstNumbered} width={300}>
                {({ width, height, scale }) => {
                  const size = Number(fontSize) * scale;
                  const margin = mmToPt(Number(marginMm));
                  // Approximate width for placement (Helvetica averages ~0.5 em per character).
                  const tw = sampleText.length * Number(fontSize) * 0.5;
                  const { cx, cy } = anchorCenter(position, tw, Number(fontSize) * 0.72, width, height, margin);
                  return (
                    <span
                      className="absolute leading-none whitespace-nowrap"
                      style={{
                        left: cx * scale,
                        top: (height - cy) * scale,
                        transform: 'translate(-50%, -50%)',
                        fontSize: size,
                        color,
                        fontFamily: 'Helvetica, Arial, sans-serif',
                      }}
                    >
                      {sampleText}
                    </span>
                  );
                }}
              </PreviewPage>
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">Choose valid options to see a preview.</p>
          )}
        </Panel>
      </div>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Could not add page numbers" />
      {result.value && <ResultFiles files={[result.value]} />}
    </>
  );
}
