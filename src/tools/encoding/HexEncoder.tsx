import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { NumberInput, Select, Switch } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { DownloadButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { formatBytes, pluralize } from '@/lib/utils';
import { HEX_SEPARATORS, hexConvert, type HexSeparator } from './lib/hexBinary';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';

const ID = 'hex-encoder';
const SAMPLE_TEXT = 'Hello, Wörld! 😀';
const SAMPLE_HEX = '48 65 6c 6c 6f 2c 20 57 c3 b6 72 6c 64 21 20 f0 9f 98 80';

interface Settings {
  separator: HexSeparator;
  uppercase: boolean;
  bytesPerLine: number | '';
}

export default function HexEncoder() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [s, setS] = useToolState<Settings>(ID, 'settings', { separator: 'space', uppercase: false, bytesPerLine: '' });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const options = useMemo(
    () => ({ separator: s.separator, uppercase: s.uppercase, bytesPerLine: typeof s.bytesPerLine === 'number' ? s.bytesPerLine : 0 }),
    [s.separator, s.uppercase, s.bytesPerLine],
  );
  const task = useTask('hexConvert', hexConvert, deferred ? [deferred, direction, options] : null, { size: deferred.length });
  const result = task.value;
  const output = result?.ok ? result.text : '';

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output) && !task.pending} labels={{ encode: 'Text → Hex', decode: 'Hex → Text' }} />
        {direction === 'encode' ? (
          <>
            <Opt label="Format">
              <Select value={s.separator} onChange={(e) => set('separator', e.target.value as HexSeparator)} aria-label="Hex format" className="w-48">
                {HEX_SEPARATORS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label} ({h.example})
                  </option>
                ))}
              </Select>
            </Opt>
            <Opt label="Bytes per line" className="w-32">
              <NumberInput
                value={s.bytesPerLine}
                onChange={(v) => set('bytesPerLine', v === '' ? '' : Math.max(1, Math.round(v)))}
                min={1}
                placeholder="All on one"
                aria-label="Bytes per line"
              />
            </Opt>
            <Switch label="Uppercase" checked={s.uppercase} onChange={(v) => set('uppercase', v)} className="pb-1.5" />
          </>
        ) : (
          <p className="pb-2 text-[12.5px] text-fg-muted">Accepts 48 65, 4865, 48:65, 0x48 0x65, \x48\x65 and %48%65. Bytes are decoded as UTF-8.</p>
        )}
      </ToolBar>
      <ErrorMessage error={task.error} title="Could not convert this text" />
      {result && !result.ok && (
        <Alert
          tone="danger"
          title={result.bytes ? 'Not valid UTF-8 text' : 'Invalid hex'}
          action={result.bytes ? <DownloadButton data={() => new Blob([result.bytes!.slice()])} filename="bytes.bin" label="Download bytes" /> : undefined}
        >
          {result.error}
          {result.lossy !== undefined && <span className="mt-1 block text-fg-secondary">With replacement characters: {result.lossy.slice(0, 200)}</span>}
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Text' : 'Hex'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'Text to convert to hex bytes…' : 'Hex bytes to decode…'}
          sample={direction === 'encode' ? SAMPLE_TEXT : SAMPLE_HEX}
          fileAccept={TEXT_FILE_ACCEPT}
          invalid={Boolean(result && !result.ok)}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={direction === 'encode' ? 'Hex (UTF-8 bytes)' : 'Text'}
          value={output}
          placeholder="Result appears here"
          downloadName={direction === 'encode' ? 'hex.txt' : 'decoded.txt'}
          height="320px"
          busy={task.pending}
          footer={result?.ok ? <span>{pluralize(result.bytes, 'byte')}{result.bytes >= 1024 ? ` (${formatBytes(result.bytes)})` : ''}</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
