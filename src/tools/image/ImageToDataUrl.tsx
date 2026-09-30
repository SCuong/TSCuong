import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { useDebouncedValue, useObjectUrl, useToolState } from '@/lib/hooks';
import { baseName, errorMessage, formatBytes } from '@/lib/utils';
import { FORMAT_INFO, sniffImageFormat, type ImageFormat } from './lib/formats';
import { snippets, svgToDataUrl } from './lib/dataurl';
import { IMAGE_ACCEPT } from './lib/accept';

type Output = 'dataUrl' | 'css' | 'html' | 'markdown' | 'base64';

const MAX_FILE = 20 * 1024 * 1024;
/** Outputs longer than this are previewed instead of loaded into the editor. */
const LARGE_OUTPUT = 1_000_000;
const PREVIEW_CHARS = 2_000;

/** The Base64 payload of a file, encoded by the browser. */
function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

interface Loaded {
  file: File;
  format: ImageFormat;
  base64Url: string;
  svgText: string | null;
}

export default function ImageToDataUrl() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useToolState<Output>('image-to-data-url', 'output', 'dataUrl');
  const [svgEncoding, setSvgEncoding] = useToolState<'base64' | 'url'>('image-to-data-url', 'svgEncoding', 'url');
  const [alt, setAlt] = useState('');
  const preview = useObjectUrl(data?.file);

  async function open(file: File) {
    setError(null);
    try {
      if (file.size > MAX_FILE) throw new Error(`This file is ${formatBytes(file.size)}. Data URLs that large are impractical (limit 20 MB).`);
      if (file.size === 0) throw new Error('The file is empty.');
      const format = sniffImageFormat(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
      if (!format) throw new Error('This file is not a recognized image (checked by its contents).');
      const svgText = format === 'svg' ? await file.text() : null;
      // FileReader encodes Base64 natively (a pure-JS loop over megabytes would freeze the page).
      setData({ file, format, base64Url: `data:${FORMAT_INFO[format].mime};base64,${await fileBase64(file)}`, svgText });
      setAlt(baseName(file.name));
    } catch (e) {
      setData(null);
      setError(errorMessage(e, 'Could not read the file.'));
    }
  }

  const url = useMemo(() => (data ? (data.svgText !== null && svgEncoding === 'url' ? svgToDataUrl(data.svgText) : data.base64Url) : ''), [data, svgEncoding]);
  // Snippets of large images are megabytes long: don't rebuild them on every keystroke.
  const debouncedAlt = useDebouncedValue(alt, 250);
  const snippetAlt = url.length > LARGE_OUTPUT ? debouncedAlt : alt;
  const text = useMemo(() => {
    if (!url) return '';
    if (output === 'base64') return url.includes(';base64,') ? url.slice(url.indexOf(',') + 1) : '';
    const s = snippets(url, snippetAlt);
    return output === 'dataUrl' ? s.dataUrl : s[output];
  }, [url, output, snippetAlt]);
  const outputTitle = output === 'dataUrl' ? 'Data URL' : output === 'css' ? 'CSS' : output === 'html' ? 'HTML' : output === 'markdown' ? 'Markdown' : 'Base64';
  const outputFile = data ? `${baseName(data.file.name)}.${output === 'css' ? 'css' : output === 'html' ? 'html' : output === 'markdown' ? 'md' : 'txt'}` : 'output.txt';

  const size = useMemo(() => new Blob([url]).size, [url]);
  const overhead = data ? ((size - data.file.size) / data.file.size) * 100 : 0;

  return (
    <ToolStack>
      <FileDrop accept={IMAGE_ACCEPT} onFiles={(f) => void open(f[0])} icon={FileCode} compact={Boolean(data)} title="Drop an image to convert to a data URL" />
      <ErrorMessage error={error} />
      {data && (
        <>
          <ToolBar>
            <div className="min-w-0">
              <Label>Output</Label>
              <Segmented
                label="Output"
                value={output}
                onChange={setOutput}
                options={[
                  { value: 'dataUrl', label: 'Data URL' },
                  { value: 'css', label: 'CSS' },
                  { value: 'html', label: 'HTML <img>' },
                  { value: 'markdown', label: 'Markdown' },
                  { value: 'base64', label: 'Base64 only' },
                ]}
              />
            </div>
            {data.svgText !== null && (
              <div className="min-w-0">
                <Label>SVG encoding</Label>
                <Segmented
                  label="SVG encoding"
                  value={svgEncoding}
                  onChange={setSvgEncoding}
                  options={[
                    { value: 'url', label: 'URL-encoded (smaller)' },
                    { value: 'base64', label: 'Base64' },
                  ]}
                />
              </div>
            )}
            {(output === 'html' || output === 'markdown') && (
              <div className="w-56">
                <Label htmlFor="du-alt">Alt text</Label>
                <Input id="du-alt" value={alt} onChange={(e) => setAlt(e.target.value)} />
              </div>
            )}
          </ToolBar>
          {size > 1024 * 1024 ? (
            <Alert tone="warning" title="Very large data URL">
              {formatBytes(size)} of text. Inlining images this big slows down pages and editors; link to the file instead.
            </Alert>
          ) : size > 10 * 1024 ? (
            <Alert tone="info">
              {formatBytes(size)}: inlining is best for small images (under about 10 KB) like icons, because inlined data can't be cached separately.
            </Alert>
          ) : null}
          {output === 'base64' && !text && <Alert tone="info">This SVG uses URL encoding. Switch SVG encoding to Base64 to get raw Base64.</Alert>}
          <div className="grid min-w-0 gap-4 lg:grid-cols-[280px_1fr]">
            <Panel
              title={data.file.name}
              description={`${FORMAT_INFO[data.format].label} · ${formatBytes(data.file.size)}`}
              actions={<Button size="sm" variant="ghost" onClick={() => setData(null)}>Clear</Button>}
            >
              {preview && (
                <div className="lk-checker flex justify-center overflow-hidden rounded-lg border border-line p-2">
                  <img src={preview} alt="" className="max-h-48 object-contain" />
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                <Badge>{FORMAT_INFO[data.format].mime}</Badge>
                <Badge tone={overhead > 0 ? 'warning' : 'success'}>
                  {formatBytes(size)} ({overhead >= 0 ? '+' : ''}
                  {overhead.toFixed(0)}%)
                </Badge>
              </div>
            </Panel>
            {text.length > LARGE_OUTPUT ? (
              // Showing megabytes of text in an editor freezes the page: preview the start, copy/download the whole.
              <Panel
                title={outputTitle}
                description={`${text.length.toLocaleString()} characters: too long to show in full`}
                actions={
                  <>
                    <CopyButton value={text} label="Copy all" />
                    <DownloadButton data={text} filename={outputFile} label="Download" />
                  </>
                }
              >
                <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12px] break-all whitespace-pre-wrap text-fg">
                  {text.slice(0, PREVIEW_CHARS)}…
                </pre>
              </Panel>
            ) : (
              <EditorPanel
                title={outputTitle}
                value={text}
                height="320px"
                downloadName={outputFile}
                footer={<span>{text.length.toLocaleString()} characters</span>}
              />
            )}
          </div>
        </>
      )}
    </ToolStack>
  );
}
