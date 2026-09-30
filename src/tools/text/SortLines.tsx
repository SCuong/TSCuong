import { useDeferredValue, useMemo, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { sortLines, type SortMode } from './lib/lines';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'sort-lines';
const SAMPLE = 'banana\nApple\ncherry\nitem 10\nitem 2\nitem 1\napple\nDate\n\nelderberry\nbanana';

const MODES: Array<{ value: SortMode; label: string; title: string }> = [
  { value: 'natural', label: 'Natural', title: 'Alphabetical, with numbers compared by value (item 2 before item 10)' },
  { value: 'alpha', label: 'Alphabetical', title: 'Dictionary order for your language' },
  { value: 'codepoint', label: 'Code point', title: 'Raw Unicode code point order (ASCII order for plain English), independent of language' },
  { value: 'length', label: 'Length', title: 'By number of characters' },
  { value: 'reverse', label: 'Reverse', title: 'Reverse the current line order' },
  { value: 'shuffle', label: 'Shuffle', title: 'Random order using the Web Crypto API' },
];

export default function SortLines() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [mode, setMode] = useToolState<SortMode>(ID, 'mode', 'natural');
  const [descending, setDescending] = useToolState(ID, 'descending', false);
  const [caseInsensitive, setCaseInsensitive] = useToolState(ID, 'caseInsensitive', true);
  const [unique, setUnique] = useToolState(ID, 'unique', false);
  const [trim, setTrim] = useToolState(ID, 'trim', false);
  const [removeEmpty, setRemoveEmpty] = useToolState(ID, 'removeEmpty', false);
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const deferred = useDeferredValue(input);
  const result = useMemo(
    () => {
      void shuffleSeed; // re-run the shuffle on demand
      return sortLines(deferred, { mode, descending, caseInsensitive, unique, trim, removeEmpty });
    },
    [deferred, mode, descending, caseInsensitive, unique, trim, removeEmpty, shuffleSeed],
  );
  const ordered = mode !== 'reverse' && mode !== 'shuffle';

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Sort by">
          <Select value={mode} onChange={(e) => setMode(e.target.value as SortMode)} aria-label="Sort by" className="w-48">
            {MODES.map((m) => (
              <option key={m.value} value={m.value} title={m.title}>
                {m.label}
              </option>
            ))}
          </Select>
        </Opt>
        {ordered && (
          <Opt label="Order">
            <Segmented
              label="Order"
              value={descending ? 'desc' : 'asc'}
              onChange={(v) => setDescending(v === 'desc')}
              options={[
                { value: 'asc', label: mode === 'length' ? 'Shortest first' : 'A → Z' },
                { value: 'desc', label: mode === 'length' ? 'Longest first' : 'Z → A' },
              ]}
            />
          </Opt>
        )}
        {mode === 'shuffle' && (
          <Button icon={Shuffle} onClick={() => setShuffleSeed((s) => s + 1)} disabled={!input} className="mb-px">
            Shuffle again
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Ignore case" checked={caseInsensitive} onChange={setCaseInsensitive} />
          <Switch label="Unique only" checked={unique} onChange={setUnique} />
          <Switch label="Trim lines" checked={trim} onChange={setTrim} />
          <Switch label="Remove empty lines" checked={removeEmpty} onChange={setRemoveEmpty} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Lines"
          value={input}
          onChange={setInput}
          placeholder="Paste lines to sort…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          lineWrapping={false}
          height="440px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="Sorted"
          value={result.text}
          placeholder="Sorted lines appear here"
          downloadName="sorted.txt"
          lineWrapping={false}
          height="440px"
          footer={
            input ? (
              <>
                <span>{pluralize(result.count, 'line')}</span>
                {result.removed > 0 && <span>{pluralize(result.removed, 'line')} removed</span>}
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
