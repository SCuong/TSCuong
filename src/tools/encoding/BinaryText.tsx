import { useDeferredValue } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { DownloadButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { binaryConvert, type BinaryEncodeOptions } from './lib/hexBinary';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';

const ID = 'binary-text';
const SAMPLE_TEXT = 'Hi! é';
const SAMPLE_BINARY = '01001000 01101001 00100001 00100000 11000011 10101001';

export default function BinaryText() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [separator, setSeparator] = useToolState<BinaryEncodeOptions['separator']>(ID, 'separator', 'space');

  const deferred = useDeferredValue(input);
  const task = useTask('binaryConvert', binaryConvert, deferred ? [deferred, direction, { separator }] : null, { size: deferred.length });
  const result = task.value;
  const output = result?.ok ? result.text : '';

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output) && !task.pending} labels={{ encode: 'Text → Binary', decode: 'Binary → Text' }} />
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
      <ErrorMessage error={task.error} title="Could not convert this text" />
      {result && !result.ok && (
        <Alert
          tone="danger"
          title={result.bytes ? 'Not valid UTF-8 text' : 'Cannot decode'}
          action={result.bytes ? <DownloadButton data={() => new Blob([result.bytes!.slice()])} filename="bytes.bin" label="Download bytes" /> : undefined}
        >
          {result.error}
          {result.lossy !== undefined && <span className="mt-1 block text-fg-secondary">With replacement characters: {result.lossy.slice(0, 200)}</span>}
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
        <OutputPanel
          title={direction === 'encode' ? 'Binary (UTF-8 bytes)' : 'Text'}
          value={output}
          placeholder="Result appears here"
          downloadName={direction === 'encode' ? 'binary.txt' : 'decoded.txt'}
          height="320px"
          busy={task.pending}
          footer={result?.ok ? <span>{pluralize(result.bytes, 'byte')}</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
