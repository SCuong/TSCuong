import { useDeferredValue } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { reverseText, type ReverseMode } from './lib/reverse';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { OutputPanel } from './components/OutputPanel';
import { useTask } from './components/useTask';

const ID = 'reverse-text';
const SAMPLE = 'Hello, world! 👋🏽\nFamily: 👨‍👩‍👧 Flag: 🇻🇳 Café\nThe quick brown fox';

export default function ReverseText() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [mode, setMode] = useToolState<ReverseMode>(ID, 'mode', 'characters');
  const [perLine, setPerLine] = useToolState(ID, 'perLine', true);

  const deferred = useDeferredValue(input);
  const task = useTask('reverseText', reverseText, [deferred, { mode, perLine }], { size: deferred.length });
  const output = task.value ?? '';

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Reverse">
          <Segmented
            label="Reverse"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'characters', label: 'Characters' },
              { value: 'words', label: 'Word order' },
              { value: 'wordLetters', label: 'Letters in each word' },
              { value: 'lines', label: 'Line order' },
            ]}
          />
        </Opt>
        {(mode === 'characters' || mode === 'words') && (
          <Switch label="Keep line order (reverse each line)" checked={perLine} onChange={setPerLine} className="pb-1.5" />
        )}
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Text"
          value={input}
          onChange={setInput}
          placeholder="Type or paste text to reverse…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="360px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title="Reversed"
          value={output}
          placeholder="Reversed text appears here"
          downloadName="reversed.txt"
          height="360px"
          busy={task.pending}
          footer={input ? <span>Emoji, flags and accented letters stay intact.</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
