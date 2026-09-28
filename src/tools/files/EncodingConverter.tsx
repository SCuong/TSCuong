import { useMemo, useState } from 'react';
import { Download, FileType, X } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Label, Select, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import {
  convertLineEndings,
  countLineEndings,
  DECODE_ENCODINGS,
  decodeBytes,
  describeLineEndings,
  detectEncoding,
  encodeText,
  encodingName,
  OUTPUT_ENCODINGS,
  outputFileName,
  type LineEnding,
  type OutputEncoding,
} from './lib/encoding';

const MAX_FILE = 100 * 1024 * 1024;
const PREVIEW_CHARS = 100_000;

interface Loaded {
  file: File;
  bytes: Uint8Array;
}

const GROUPS = [...new Set(DECODE_ENCODINGS.map((e) => e.group))];

export default function EncodingConverter() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('auto');
  const [target, setTarget] = useToolState<OutputEncoding>('file-encoding-converter', 'target', 'utf-8');
  const [eol, setEol] = useToolState<LineEnding>('file-encoding-converter', 'eol', 'keep');

  async function open(file: File) {
    setError(null);
    if (file.size > MAX_FILE) {
      setError(`This file is ${formatBytes(file.size)}. Text files up to ${formatBytes(MAX_FILE)} can be converted in the browser.`);
      return;
    }
    setLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setLoaded({ file, bytes });
      setSource('auto');
    } catch (e) {
      setError(errorMessage(e, 'The file could not be read.'));
    } finally {
      setLoading(false);
    }
  }

  const detection = useMemo(() => (loaded ? detectEncoding(loaded.bytes) : null), [loaded]);
  const label = source === 'auto' ? (detection?.encoding ?? 'utf-8') : source;

  const decoded = useMemo(() => {
    if (!loaded) return null;
    try {
      return {
        ...decodeBytes(loaded.bytes, label),
        error: null as string | null,
      };
    } catch (e) {
      return {
        text: '',
        replacements: 0,
        error: errorMessage(e, 'This encoding is not supported by your browser.'),
      };
    }
  }, [loaded, label]);

  const binaryLike = useMemo(() => {
    if (!loaded || label.startsWith('utf-16')) return false;
    const sample = loaded.bytes.subarray(0, 8192);
    return sample.includes(0);
  }, [loaded, label]);

  const eolCounts = useMemo(() => (decoded ? countLineEndings(decoded.text) : null), [decoded]);

  function convert() {
    if (!loaded || !decoded) return;
    try {
      const out = encodeText(convertLineEndings(decoded.text, eol), target);
      const mime = target.startsWith('utf-16') ? 'text/plain;charset=utf-16' : 'text/plain;charset=utf-8';
      downloadBlob(new Blob([out as Uint8Array<ArrayBuffer>], { type: mime }), outputFileName(loaded.file.name, target));
    } catch (e) {
      setError(errorMessage(e, 'Could not convert the file.'));
    }
  }

  const outputSize = useMemo(() => {
    if (!decoded) return 0;
    const text = convertLineEndings(decoded.text, eol);
    if (target.startsWith('utf-16')) return text.length * 2 + (target === 'utf-16le' ? 0 : 2);
    return new TextEncoder().encode(text).length + (target === 'utf-8-bom' ? 3 : 0) - (text.charCodeAt(0) === 0xfeff ? 3 : 0);
  }, [decoded, eol, target]);

  const preview = decoded ? convertLineEndings(decoded.text.slice(0, PREVIEW_CHARS), 'lf') : '';

  return (
    <ToolStack>
      <FileDrop
        onFiles={(f) => void open(f[0])}
        icon={FileType}
        compact={Boolean(loaded)}
        title="Drop a text file to convert its encoding"
        hint="CSV, TXT, SRT, source code… up to 100 MB. Nothing is uploaded."
      />
      {loading && <Spinner label="Reading file…" />}
      <ErrorMessage error={error} />
      {loaded && detection && decoded && (
        <>
          <Panel
            title={loaded.file.name}
            description={`${formatBytes(loaded.file.size)} · ${loaded.file.size.toLocaleString()} bytes`}
            actions={<IconButton icon={X} size="sm" label="Close file" onClick={() => setLoaded(null)} />}
          >
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-fg-muted">Detected encoding</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-fg">
                  <span className="font-medium">{encodingName(detection.encoding)}</span>
                  <Badge tone={detection.confidence === 'guess' ? 'warning' : 'success'}>
                    {detection.confidence === 'certain' ? 'BOM' : detection.confidence === 'high' ? 'Confident' : 'Guess'}
                  </Badge>
                </dd>
                <dd className="mt-1 text-[12.5px] text-fg-muted">{detection.reason}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Byte order mark</dt>
                <dd className="mt-0.5 text-fg">{detection.bom ? `Yes (${encodingName(detection.bom.encoding)})` : 'None'}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Line endings</dt>
                <dd className="mt-0.5 text-fg">{eolCounts ? describeLineEndings(eolCounts) : '—'}</dd>
              </div>
            </dl>
          </Panel>
          <ToolBar>
            <div className="w-full sm:w-72">
              <Label htmlFor="enc-source">Decode as</Label>
              <Select id="enc-source" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="auto">Auto ({encodingName(detection.encoding)})</option>
                {GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {DECODE_ENCODINGS.filter((e) => e.group === g).map((e) => (
                      <option key={e.label} value={e.label}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <Label htmlFor="enc-target">Convert to</Label>
              <Select id="enc-target" value={target} onChange={(e) => setTarget(e.target.value as OutputEncoding)}>
                {OUTPUT_ENCODINGS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="max-w-full">
              <Label>Line endings</Label>
              <Segmented
                label="Line endings"
                value={eol}
                onChange={setEol}
                options={[
                  { value: 'keep', label: 'Keep' },
                  { value: 'lf', label: 'LF' },
                  { value: 'crlf', label: 'CRLF' },
                  { value: 'cr', label: 'CR' },
                ]}
              />
            </div>
            <Button variant="primary" icon={Download} onClick={convert} disabled={Boolean(decoded.error)}>
              Download
            </Button>
          </ToolBar>
          <ErrorMessage error={decoded.error} />
          {binaryLike && (
            <Alert tone="warning" title="This may not be a text file">
              It contains NUL bytes, which text in a single-byte encoding never has. It could be binary data or UTF-16 without a BOM (try
              decoding as UTF-16).
            </Alert>
          )}
          {decoded.replacements > 0 && (
            <Alert
              tone="warning"
              title={`${decoded.replacements.toLocaleString()} invalid byte sequence${decoded.replacements === 1 ? '' : 's'}`}
            >
              Some bytes are not valid in {encodingName(label)} and were replaced with �. Try another source encoding if the preview looks
              wrong.
            </Alert>
          )}
          <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
            <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-1.5">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">Preview ({encodingName(label)})</h2>
              <span className="text-[12.5px] text-fg-muted">
                {decoded.text.length.toLocaleString()} characters · output {formatBytes(outputSize)}
              </span>
            </header>
            <div className="h-[420px] p-2">
              <Textarea value={preview} readOnly aria-label="Decoded text preview" className="h-full resize-none" wrap="off" />
            </div>
            {decoded.text.length > PREVIEW_CHARS && (
              <footer className="border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
                Showing the first {PREVIEW_CHARS.toLocaleString()} characters. The download contains the whole file.
              </footer>
            )}
          </section>
        </>
      )}
    </ToolStack>
  );
}
