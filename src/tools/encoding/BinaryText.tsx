import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Alert } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { binaryToText, textToBinary, type BinaryEncodeOptions } from './lib/hexBinary';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';

const ID = 'binary-text';
const SAMPLE_TEXT = 'Hi! é';
const SAMPLE_BINARY = '01001000 01101001 00100001 00100000 11000011 10101001';

export default function BinaryText() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [separator, setSeparator] = useToolState<BinaryEncodeOptions['separator']>(ID, 'separator', 'space');

  const deferred = useDeferredValue(input);
  const result = useMemo(() => {
    if (!deferred) return null;
    if (direction === 'encode') return { ok: true as const, text: textToBinary(deferred, { separator }), bytes: new TextEncoder().encode(deferred).length };
    const r = binaryToText(deferred);
    return r.ok ? { ok: true as const, text: r.text, bytes: r.bytes.length } : r;
  }, [deferred, direction, separator]);
  const output = result?.ok ? result.text : '';

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output)} labels={{ encode: 'Text → Binary', decode: 'Binary → Text' }} />
        {direction === 'encode' ? (
          <Opt label="Separate bytes with">
            <Segmented
              label="Byte separator"
              value={separator}
              onChange={setSeparator}
              options={[
                { value: 'space', label: 'Space' },
                { value: 'newline', label: 'New line' },
                { value: 'none', label: 'Nothing' },
              ]}
            />
          </Opt>
        ) : (
          <p className="pb-2 text-[12.5px] text-fg-muted">Reads 8-bit groups (spaces optional) and decodes the bytes as UTF-8, so accented letters and emoji work.</p>
        )}
      </ToolBar>
      {result && !result.ok && (
        <Alert tone="danger" title="Cannot decode">
          {result.error}
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Text' : 'Binary'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'Text to convert to binary…' : '8-bit binary groups, e.g. 01001000 01101001'}
          sample={direction === 'encode' ? SAMPLE_TEXT : SAMPLE_BINARY}
          fileAccept={TEXT_FILE_ACCEPT}
          invalid={Boolean(result && !result.ok)}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title={direction === 'encode' ? 'Binary (UTF-8 bytes)' : 'Text'}
          value={output}
          placeholder="Result appears here"
          downloadName={direction === 'encode' ? 'binary.txt' : 'decoded.txt'}
          height="320px"
          footer={result?.ok ? <span>{pluralize(result.bytes, 'byte')}</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
