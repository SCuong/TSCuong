import { useState } from 'react';
import { Link } from 'react-router';
import { FileText, ScanText } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { formatNumber, pluralize } from '@/lib/utils';
import { throwIfAborted } from '@/lib/hooks';
import { formatPageList } from './lib/ranges';
import { joinPages, runsToLines, type PageText, type TextRun } from './lib/text';
import { outputName } from './lib/files';
import { docId } from './lib/thumbnails';
import { PdfInput } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { JobProgress } from './components/Results';
import { usePdfJob } from './components/usePdfJob';

export default function ExtractText() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to extract its text">
        {(pdf) => <TextWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function TextWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [separators, setSeparators] = useState(true);
  const [pages, setPages] = useState<PageText[] | null>(null);
  const [empty, setEmpty] = useState<number[]>([]);
  const job = usePdfJob();

  async function run() {
    setPages(null);
    const list = scope.pages;
    const out = await job.run(async ({ signal, progress }) => {
      const result: PageText[] = [];
      const noText: number[] = [];
      for (let k = 0; k < list.length; k++) {
        throwIfAborted(signal);
        if (k % 5 === 0) progress(k / list.length, `Reading page ${list[k] + 1}`);
        const page = await pdf.doc.getPage(list[k] + 1);
        const content = await page.getTextContent();
        const runs = content.items.filter((it) => 'str' in it) as unknown as TextRun[];
        const text = runsToLines(runs).join('\n');
        if (!text.trim()) noText.push(list[k] + 1);
        result.push({ page: list[k] + 1, text });
        page.cleanup();
      }
      return { result, noText };
    });
    if (out) {
      setPages(out.result);
      setEmpty(out.noText);
    }
  }

  const text = pages ? joinPages(pages, separators) : '';
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const allEmpty = pages !== null && empty.length === pages.length;

  return (
    <>
      <Panel>
        <div className="flex flex-col gap-4">
          <PageScopeControl scope={scope} modes={['all', 'range']} />
          <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
            <Button
              variant="primary"
              icon={FileText}
              disabled={scope.pages.length === 0 || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              Extract text
            </Button>
            <Switch label="Page separators" checked={separators} onChange={setSeparators} />
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Could not extract text" />
      {pages && empty.length > 0 && (
        <Alert
          tone={allEmpty ? 'warning' : 'info'}
          title={allEmpty ? 'No text layer found' : `${pluralize(empty.length, 'page')} without text`}
          action={
            <Link
              to="/tools/pdf/ocr"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2.5 text-[13px] font-medium text-fg shadow-card hover:bg-surface-hover"
            >
              <ScanText size={14} aria-hidden /> Open OCR
            </Link>
          }
        >
          {allEmpty
            ? 'This PDF looks scanned: its pages are images without selectable text. Use OCR to recognize the text.'
            : `Pages ${formatPageList(empty)} contain no selectable text (they may be scans or pictures). OCR can read them.`}
        </Alert>
      )}
      {pages && (
        <EditorPanel
          title="Extracted text"
          value={text}
          readOnly
          height="520px"
          downloadName={outputName(pdf.file.name, '', 'txt')}
          downloadType="text/plain;charset=utf-8"
          placeholder="No text found."
          footer={
            <>
              <span>{pluralize(pages.length, 'page')}</span>
              <span>{formatNumber(words, 0)} words</span>
              <span>{formatNumber(text.length, 0)} characters</span>
            </>
          }
        />
      )}
    </>
  );
}
