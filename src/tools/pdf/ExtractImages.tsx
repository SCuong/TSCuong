import { useEffect, useRef, useState } from 'react';
import { Download, Images } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { formatBytes, pluralize } from '@/lib/utils';
import { throwIfAborted } from '@/lib/hooks';
import { OPS, canvasToBlob, releaseCanvas, type PDFPageProxy } from './lib/pdfjs';
import { pixelHash, toRgba, type RawImage } from './lib/imageData';
import { outputName, type OutputFile } from './lib/files';
import { docId } from './lib/thumbnails';
import { PdfInput } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { JobProgress, ResultFiles, downloadOutput } from './components/Results';
import { usePdfJob } from './components/usePdfJob';

interface Found extends OutputFile {
  page: number;
  width: number;
  height: number;
  url: string;
}

interface DecodedImage extends RawImage {
  bitmap?: ImageBitmap;
}

export default function ExtractImages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to extract its images">
        {(pdf) => <ImagesWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function getObject(page: PDFPageProxy, id: string): Promise<DecodedImage | null> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    try {
      store.get(id, (data: unknown) => {
        clearTimeout(timer);
        resolve((data as DecodedImage) ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function imageToBlob(img: DecodedImage): Promise<{ blob: Blob; hash: string } | null> {
  const { width, height } = img;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    let hash: string;
    if (img.bitmap) {
      ctx.drawImage(img.bitmap, 0, 0);
      hash = pixelHash(width, height, ctx.getImageData(0, 0, width, height).data);
    } else {
      const rgba = toRgba(img);
      if (!rgba) return null;
      ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
      hash = pixelHash(width, height, rgba);
    }
    return { blob: await canvasToBlob(canvas, 'image/png'), hash };
  } finally {
    releaseCanvas(canvas);
  }
}

function ImagesWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [skipSmall, setSkipSmall] = useState(true);
  const [found, setFound] = useState<Found[] | null>(null);
  const [stats, setStats] = useState({ duplicates: 0, skipped: 0, failed: 0, masks: 0 });
  const job = usePdfJob();
  const urls = useRef<string[]>([]);

  const revokeAll = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
  };
  useEffect(() => revokeAll, []);

  async function run() {
    revokeAll();
    setFound(null);
    const out = await job.run(async ({ signal, progress }) => {
      const results: Found[] = [];
      const seenIds = new Set<string>();
      const seenHashes = new Set<string>();
      const s = { duplicates: 0, skipped: 0, failed: 0, masks: 0 };
      for (let k = 0; k < scope.pages.length; k++) {
        throwIfAborted(signal);
        const pageNo = scope.pages[k] + 1;
        progress(k / scope.pages.length, `Scanning page ${pageNo} · ${pluralize(results.length, 'image')} found`);
        const page = await pdf.doc.getPage(pageNo);
        try {
          const list = await page.getOperatorList();
          let n = 0;
          for (let i = 0; i < list.fnArray.length; i++) {
            const fn = list.fnArray[i];
            const args = list.argsArray[i] as unknown[];
            let img: DecodedImage | null = null;
            let key: string | null = null;
            if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
              const id = args[0] as string;
              key = id.startsWith('g_') ? id : `${pageNo}:${id}`;
              if (seenIds.has(key)) {
                if (id.startsWith('g_')) s.duplicates++;
                continue;
              }
              seenIds.add(key);
              img = await getObject(page, id);
            } else if (fn === OPS.paintInlineImageXObject || fn === OPS.paintInlineImageXObjectGroup) {
              img = args[0] as DecodedImage;
            } else if (fn === OPS.paintImageMaskXObject || fn === OPS.paintImageMaskXObjectGroup || fn === OPS.paintImageMaskXObjectRepeat) {
              s.masks++;
              continue;
            } else {
              continue;
            }
            if (!img) {
              s.failed++;
              continue;
            }
            if (skipSmall && (img.width < 16 || img.height < 16)) {
              s.skipped++;
              continue;
            }
            const converted = await imageToBlob(img);
            if (!converted) {
              s.failed++;
              continue;
            }
            if (seenHashes.has(converted.hash)) {
              s.duplicates++;
              continue;
            }
            seenHashes.add(converted.hash);
            n++;
            const url = URL.createObjectURL(converted.blob);
            urls.current.push(url);
            results.push({
              name: outputName(pdf.file.name, `p${pageNo}-img${n}`, 'png'),
              data: converted.blob,
              type: 'image/png',
              page: pageNo,
              width: img.width,
              height: img.height,
              url,
            });
          }
        } finally {
          page.cleanup();
        }
      }
      return { results, s };
    });
    if (out) {
      setFound(out.results);
      setStats(out.s);
    }
  }

  return (
    <>
      <Panel>
        <div className="flex flex-col gap-4">
          <PageScopeControl scope={scope} modes={['all', 'range']} />
          <Checkbox
            label="Skip tiny images"
            description="Ignore images smaller than 16 × 16 px (usually bullets, lines and decorations)."
            checked={skipSmall}
            onChange={setSkipSmall}
          />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="primary"
              icon={Images}
              disabled={scope.pages.length === 0 || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              Extract images
            </Button>
          </div>
          <p className="text-[12.5px] text-fg-muted">
            Images are saved as PNG from the decoded pixels, so the original compression (such as JPEG) is not kept. Vector drawings are
            not images, and stencil masks or unusual image types may not be extractable.
          </p>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Could not extract images" />
      {found && (stats.duplicates > 0 || stats.skipped > 0 || stats.failed > 0 || stats.masks > 0) && (
        <Alert tone="info">
          {[
            stats.duplicates > 0 && `${pluralize(stats.duplicates, 'duplicate')} skipped`,
            stats.skipped > 0 && `${pluralize(stats.skipped, 'tiny image')} skipped`,
            stats.masks > 0 && `${pluralize(stats.masks, 'stencil mask')} not exported`,
            stats.failed > 0 && `${pluralize(stats.failed, 'image')} could not be decoded`,
          ]
            .filter(Boolean)
            .join(' · ')}
          .
        </Alert>
      )}
      {found && found.length === 0 && (
        <EmptyState icon={Images} title="No images found">
          These pages don't contain extractable raster images. Text and vector graphics can be captured with PDF to Images instead.
        </EmptyState>
      )}
      {found && found.length > 0 && (
        <>
          <ResultFiles files={found} showList={found.length === 1} zipName={outputName(pdf.file.name, 'images', 'zip')} title={`${pluralize(found.length, 'image')} extracted`} />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3" aria-label="Extracted images">
            {found.slice(0, 300).map((img) => (
              <li key={img.url} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-1.5 shadow-card">
                <div className="lk-checker flex aspect-square items-center justify-center overflow-hidden rounded-lg">
                  <img src={img.url} alt={`Image from page ${img.page}`} className="max-h-full max-w-full object-contain" loading="lazy" />
                </div>
                <div className="flex items-center gap-1 px-1 pt-1.5">
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[12.5px] font-medium text-fg">Page {img.page}</p>
                    <p className="truncate text-[11.5px] text-fg-muted">
                      {img.width} × {img.height} · {formatBytes((img.data as Blob).size)}
                    </p>
                  </div>
                  <IconButton icon={Download} label={`Download ${img.name}`} size="sm" onClick={() => downloadOutput(img)} />
                </div>
              </li>
            ))}
          </ul>
          {found.length > 300 && <p className="text-[12.5px] text-fg-muted">Showing the first 300 previews. The ZIP contains all images.</p>}
        </>
      )}
    </>
  );
}
