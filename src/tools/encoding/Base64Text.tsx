import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { DownloadButton } from '@/components/ui/Actions';
import { Badge } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { convertBase64 } from './lib/base64';
import { hexPreview } from './lib/bytes';
import { utf8Length } from '../text/lib/common';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';

const ID = 'base64-text';
const SAMPLE_TEXT = 'Hello, World! Ünïcødé and emoji work too 😀';
const SAMPLE_B64 = 'SGVsbG8sIFdvcmxkISDDnG7Dr2PDuGTDqSBhbmQgZW1vamkgd29yayB0b28g8J+YgA==';

interface Settings {
  urlSafe: boolean;
  padding: boolean;
  wrap: number;
}

export default function Base64Text() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [s, setS] = useToolState<Settings>(ID, 'settings', { urlSafe: false, padding: true, wrap: 0 });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const task = useTask('convertBase64', convertBase64, deferred ? [deferred, direction, s] : null, { size: deferred.length });
  const result = task.value;
  const note = result?.ok && direction === 'decode' && result.urlSafe ? 'URL-safe alphabet detected' : null;
  const output = result?.ok ? result.text : '';
  const inputBytes = useMemo(() => utf8Length(deferred), [deferred]);
  const outputBytes = useMemo(() => utf8Length(output), [output]);

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output) && !task.pending} />
        {direction === 'encode' ? (
          <>
            <Opt label="Line wrapping">
              <Select value={String(s.wrap)} onChange={(e) => set('wrap', Number(e.target.value))} aria-label="Line wrapping" className="w-48">
                <option value="0">No wrapping</option>
                <option value="76">76 chars (MIME)</option>
                <option value="64">64 chars (PEM)</option>
              </Select>
            </Opt>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
              <Switch label="URL-safe (- _)" checked={s.urlSafe} onChange={(v) => set('urlSafe', v)} />
              <Switch label="Padding (=)" checked={s.padding} onChange={(v) => set('padding', v)} />
            </div>
          </>
        ) : (
          <p className="pb-2 text-[12.5px] text-fg-muted">
            Accepts standard and URL-safe Base64, with or without padding, line breaks or a data: URL prefix.
          </p>
        )}
      </ToolBar>
      <ErrorMessage error={task.error} title="Could not convert this text" />
      {result && !result.ok && (
        <Alert
          tone="danger"
          title={result.bytes ? 'Not text' : 'Invalid Base64'}
          action={
            result.bytes ? (
              <DownloadButton data={() => new Blob([result.bytes!.slice()])} filename="decoded.bin" label="Download bytes" />
            ) : undefined
          }
        >
          {result.error}
          {result.bytes && (
            <span className="mt-1 block font-mono text-[12px] break-all text-fg-secondary">
              {formatBytes(result.bytes.length)}: {hexPreview(result.bytes, 24)}
            </span>
          )}
        </Alert>
      )}

      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Text' : 'Base64'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'Type or paste text to encode…' : 'Paste Base64 to decode…'}
          sample={direction === 'encode' ? SAMPLE_TEXT : SAMPLE_B64}
          fileAccept={TEXT_FILE_ACCEPT}
          invalid={Boolean(result && !result.ok)}
          height="360px"
          footer={input ? <span>{formatBytes(inputBytes)}</span> : undefined}
        />
        <OutputPanel
          title={direction === 'encode' ? 'Base64' : 'Decoded text'}
          value={output}
          placeholder={direction === 'encode' ? 'Base64 appears here' : 'Decoded text appears here'}
          downloadName={direction === 'encode' ? 'encoded.b64.txt' : 'decoded.txt'}
          height="360px"
          busy={task.pending}
          footer={
            output ? (
              <>
                <span>{formatBytes(outputBytes)}</span>
                {direction === 'encode' && inputBytes > 0 && <span>{`${Math.round((outputBytes / inputBytes) * 100)}% of input size`}</span>}
                {note && <Badge tone="accent">{note}</Badge>}
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
