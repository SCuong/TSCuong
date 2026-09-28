import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { useObjectUrl, useToolState } from '@/lib/hooks';
import { baseName, errorMessage, formatBytes } from '@/lib/utils';
import { FORMAT_INFO, sniffImageFormat, type ImageFormat } from './lib/formats';
import { snippets, svgToDataUrl, toDataUrl } from './lib/dataurl';
import { IMAGE_ACCEPT } from './lib/accept';

type Output = 'dataUrl' | 'css' | 'html' | 'markdown' | 'base64';

const MAX_FILE = 20 * 1024 * 1024;

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
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = sniffImageFormat(bytes);
      if (!format) throw new Error('This file is not a recognized image (checked by its contents).');
      const svgText = format === 'svg' ? new TextDecoder().decode(bytes) : null;
      setData({ file, format, base64Url: toDataUrl(bytes, FORMAT_INFO[format].mime), svgText });
      setAlt(baseName(file.name));
    } catch (e) {
      setData(null);
      setError(errorMessage(e, 'Could not read the file.'));
    }
  }

  const url = data ? (data.svgText !== null && svgEncoding === 'url' ? svgToDataUrl(data.svgText) : data.base64Url) : '';
  const text = useMemo(() => {
    if (!url) return '';
    if (output === 'base64') return url.includes(';base64,') ? url.slice(url.indexOf(',') + 1) : '';
    const s = snippets(url, alt);
    return output === 'dataUrl' ? s.dataUrl : s[output];
  }, [url, output, alt]);

  const size = new Blob([url]).size;
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
              <div>
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
            <EditorPanel
              title={output === 'dataUrl' ? 'Data URL' : output === 'css' ? 'CSS' : output === 'html' ? 'HTML' : output === 'markdown' ? 'Markdown' : 'Base64'}
              value={text}
              height="320px"
              downloadName={`${baseName(data.file.name)}.${output === 'css' ? 'css' : output === 'html' ? 'html' : output === 'markdown' ? 'md' : 'txt'}`}
              footer={<span>{text.length.toLocaleString()} characters</span>}
            />
          </div>
        </>
      )}
    </ToolStack>
  );
}
