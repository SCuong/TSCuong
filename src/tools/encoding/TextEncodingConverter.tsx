import { useMemo, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { FileDrop } from '@/components/ui/FileDrop';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { baseName, cn, downloadBlob, errorMessage, formatBytes, formatNumber } from '@/lib/utils';
import {
  decodeAs,
  detectBom,
  encodeOutput,
  ENCODINGS,
  guessEncoding,
  isSupported,
  rankAttempts,
  repairMojibake,
  tryAllEncodings,
  type DecodeAttempt,
  type OutputEncoding,
} from './lib/textEncoding';
import { Opt } from '../text/components/shared';

const ID = 'text-encoding-converter';
const MAX_FILE = 50 * 1024 * 1024;
const PREVIEW_CHARS = 300_000;

type Source = 'file' | 'paste';

export default function TextEncodingConverter() {
  const [source, setSource] = useToolState<Source>(ID, 'source', 'file');
  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Source">
          <Segmented
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: 'file', label: 'Open a file' },
              { value: 'paste', label: 'Fix garbled pasted text' },
            ]}
          />
        </Opt>
        <p className="pb-2 text-[12.5px] text-fg-muted">
          {source === 'file'
            ? 'Detect how a text file is encoded and save it as UTF-8 or UTF-16.'
            : 'Repair “mojibake” such as cafÃ© or â€™ that appears when text is decoded with the wrong encoding.'}
        </p>
      </ToolBar>
      {source === 'file' ? <FileMode /> : <PasteMode />}
    </ToolStack>
  );
}

/* ------------------------------------------------------------------------ */

const OUTPUTS: Array<{ value: OutputEncoding; label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-8-bom', label: 'UTF-8 with BOM' },
  { value: 'utf-16le-bom', label: 'UTF-16 LE with BOM' },
  { value: 'utf-16be-bom', label: 'UTF-16 BE with BOM' },
];

function FileMode() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; attempts: DecodeAttempt[]; guess: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('utf-8');
  const [output, setOutput] = useToolState<OutputEncoding>(ID, 'output', 'utf-8');
  const [showAll, setShowAll] = useState(false);

  async function onFile(f: File) {
    setError(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const attempts = tryAllEncodings(bytes);
      const guess = guessEncoding(bytes, attempts);
      setSelected(guess);
      setFile({ name: f.name, bytes, attempts, guess });
      setShowAll(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not read the file.'));
    }
  }

  const bom = useMemo(() => (file ? detectBom(file.bytes) : null), [file]);
  const attempts = useMemo(() => file?.attempts ?? [], [file]);
  const decoded = useMemo(() => {
    if (!file) return null;
    const info = ENCODINGS.find((e) => e.label === selected) ?? ENCODINGS[0];
    return decodeAs(file.bytes, info);
  }, [file, selected]);

  // Best guess first, then the other valid decodings by plausibility, then the invalid ones.
  const ranked = useMemo(() => {
    const valid = rankAttempts(attempts);
    const guess = attempts.find((a) => a.encoding.label === file?.guess);
    const rest = [...valid, ...attempts.filter((a) => !a.valid)].filter((a) => a !== guess);
    return guess ? [guess, ...rest] : rest;
  }, [attempts, file]);
  const validCount = attempts.filter((a) => a.valid).length;
  const visible = showAll ? ranked : ranked.slice(0, 8);
  if (!showAll && !visible.some((a) => a.encoding.label === selected)) {
    const sel = ranked.find((a) => a.encoding.label === selected);
    if (sel) visible.push(sel);
  }

  function download() {
    if (!decoded || !file) return;
    const bytes = encodeOutput(decoded.text, output);
    const ext = /\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? '.txt';
    downloadBlob(new Blob([bytes.slice()], { type: 'text/plain' }), `${baseName(file.name)}.${output.startsWith('utf-16') ? 'utf16' : 'utf8'}${ext}`);
  }

  if (!file) {
    return (
      <>
        <FileDrop
          onFiles={(files) => void onFile(files[0])}
          maxSize={MAX_FILE}
          icon={FileText}
          title="Drop a text file"
          hint="Subtitles, CSV exports, old documents… up to 50 MB. Read locally, never uploaded."
          onReject={setError}
        />
        <ErrorMessage error={error} />
      </>
    );
  }

  return (
    <>
      <Panel
        title={<span className="break-all">{file.name}</span>}
        description={`${formatBytes(file.bytes.length)} · ${bom ? `${bom.bom.toUpperCase()} byte order mark (BOM) found` : 'No byte order mark'} · ${validCount} of ${attempts.length} encodings decode without errors`}
        actions={<IconButton icon={X} label="Open another file" size="sm" onClick={() => setFile(null)} />}
        bodyClassName="p-0"
      >
        <fieldset>
          <legend className="sr-only">Decode the file as</legend>
          <ul className="divide-y divide-line/70">
            {visible.map((a) => (
              <EncodingRow key={a.encoding.label} attempt={a} best={a.encoding.label === file.guess} selected={a.encoding.label === selected} onSelect={() => setSelected(a.encoding.label)} />
            ))}
          </ul>
        </fieldset>
        {ranked.length > visible.length && (
          <div className="border-t border-line px-4 py-2">
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show all {ranked.length} encodings
            </Button>
          </div>
        )}
      </Panel>
      <Alert tone="info">
        Single-byte encodings (Windows-125x, ISO-8859-x, KOI8) accept almost any bytes, so “valid” only means no undefined bytes; compare the
        previews. ISO-8859-1 and ISO-8859-9 are read as their Windows supersets, as browsers do.
      </Alert>
      {decoded && (
        <EditorPanel
          title={`Decoded as ${decoded.encoding.name}`}
          value={decoded.text.length > PREVIEW_CHARS ? `${decoded.text.slice(0, PREVIEW_CHARS)}…` : decoded.text}
          height="320px"
          invalid={!decoded.valid}
          footer={
            <>
              <span>{formatNumber(decoded.text.length, 0)} characters</span>
              {decoded.replacements > 0 && <span className="text-warning">{formatNumber(decoded.replacements, 0)} undecodable bytes shown as �</span>}
              {decoded.text.length > PREVIEW_CHARS && <span>Preview truncated; the download is complete.</span>}
            </>
          }
          ariaLabel="Decoded text"
        />
      )}
      <ToolBar>
        <Opt label="Save as">
          <Select value={output} onChange={(e) => setOutput(e.target.value as OutputEncoding)} aria-label="Output encoding" className="w-56">
            {OUTPUTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Opt>
        <Button variant="primary" icon={Download} onClick={download} className="mb-px">
          Download converted file
        </Button>
        <p className="w-full text-[12.5px] text-fg-muted">
          Browsers can only write Unicode (UTF-8 or UTF-16). Saving back to legacy encodings such as Shift_JIS or Windows-1252 is not possible here.
        </p>
      </ToolBar>
    </>
  );
}

function EncodingRow({ attempt, best, selected, onSelect }: { attempt: DecodeAttempt; best: boolean; selected: boolean; onSelect: () => void }) {
  const preview = attempt.text.slice(0, 160).replace(/\s+/g, ' ');
  return (
    <li>
      <label
        className={cn(
          'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-surface-hover sm:grid-cols-[auto_minmax(180px,260px)_auto_minmax(0,1fr)]',
          selected && 'bg-accent-soft hover:bg-accent-soft',
        )}
      >
        <input type="radio" name="encoding" checked={selected} onChange={onSelect} className="size-4 accent-[var(--lk-accent)]" />
        <span className="truncate text-[13px] font-medium text-fg">{attempt.encoding.name}</span>
        {attempt.valid ? (
          <Badge tone={best ? 'success' : 'neutral'}>{best ? 'Valid · best guess' : 'Valid'}</Badge>
        ) : (
          <Badge tone="danger">Invalid bytes</Badge>
        )}
        <span className="col-span-2 col-start-2 truncate font-mono text-[12.5px] text-fg-secondary sm:col-span-1 sm:col-start-auto">{preview || '—'}</span>
      </label>
    </li>
  );
}

/* ------------------------------------------------------------------------ */

const SINGLE_BYTE = ENCODINGS.filter((e) => e.singleByte && isSupported(e.label));
const TARGETS = ENCODINGS.filter((e) => isSupported(e.label));
// Built at runtime so the sample is exactly what a wrong Windows-1252 decode produces.
const PASTE_SAMPLE = new TextDecoder('windows-1252').decode(new TextEncoder().encode('Don’t panic — the café is open. Привет!'));

function PasteMode() {
  const [input, setInput] = useToolState(ID, 'paste', '');
  const [wrong, setWrong] = useToolState(ID, 'wrong', 'windows-1252');
  const [right, setRight] = useToolState(ID, 'right', 'utf-8');
  const result = useMemo(() => (input ? repairMojibake(input, wrong, right) : null), [input, wrong, right]);

  return (
    <>
      <ToolBar>
        <Opt label="Text was wrongly read as">
          <Select value={wrong} onChange={(e) => setWrong(e.target.value)} aria-label="Wrong encoding" className="w-64">
            {SINGLE_BYTE.map((e) => (
              <option key={e.label} value={e.label}>
                {e.name}
              </option>
            ))}
          </Select>
        </Opt>
        <Opt label="It is actually">
          <Select value={right} onChange={(e) => setRight(e.target.value)} aria-label="Actual encoding" className="w-64">
            {TARGETS.map((e) => (
              <option key={e.label} value={e.label}>
                {e.name}
              </option>
            ))}
          </Select>
        </Opt>
      </ToolBar>
      <ErrorMessage error={result && !result.ok ? result.error : null} title="Cannot repair with these encodings" />
      <SplitPanes>
        <EditorPanel
          title="Garbled text"
          value={input}
          onChange={setInput}
          placeholder="Paste text like cafÃ© or donâ€™t…"
          sample={PASTE_SAMPLE}
          height="280px"
          invalid={Boolean(result && !result.ok)}
        />
        <EditorPanel title="Repaired text" value={result?.ok ? result.text : ''} placeholder="Repaired text appears here" downloadName="repaired.txt" height="280px" />
      </SplitPanes>
    </>
  );
}
