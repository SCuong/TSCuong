import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatNumber } from '@/lib/utils';
import { removeDuplicateLines, type DedupeOptions } from './lib/lines';
import { Counts, Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'remove-duplicate-lines';
const SAMPLE = 'apple\nbanana\nApple\ncherry\nbanana\n  cherry  \ndate\napple\n\nelderberry\n';

export default function RemoveDuplicateLines() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [keep, setKeep] = useToolState<DedupeOptions['keep']>(ID, 'keep', 'first');
  const [caseInsensitive, setCaseInsensitive] = useToolState(ID, 'caseInsensitive', false);
  const [whitespace, setWhitespace] = useToolState<DedupeOptions['whitespace']>(ID, 'whitespace', 'none');
  const [keepBlank, setKeepBlank] = useToolState(ID, 'keepBlank', false);

  const deferred = useDeferredValue(input);
  const result = useMemo(
    () => removeDuplicateLines(deferred, { keep, caseInsensitive, whitespace, keepBlank }),
    [deferred, keep, caseInsensitive, whitespace, keepBlank],
  );

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Keep">
          <Segmented
            label="Which occurrence to keep"
            value={keep}
            onChange={setKeep}
            options={[
              { value: 'first', label: 'First occurrence' },
              { value: 'last', label: 'Last occurrence' },
            ]}
          />
        </Opt>
        <Opt label="Whitespace">
          <Select value={whitespace} onChange={(e) => setWhitespace(e.target.value as DedupeOptions['whitespace'])} aria-label="Whitespace comparison" className="w-72">
            <option value="none">Compare exactly</option>
            <option value="trim">Ignore leading/trailing spaces</option>
            <option value="all">Ignore extra spaces (trim and collapse)</option>
          </Select>
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Ignore case" checked={caseInsensitive} onChange={setCaseInsensitive} />
          <Switch label="Keep blank lines" checked={keepBlank} onChange={setKeepBlank} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          placeholder="Paste a list with duplicate lines…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          lineWrapping={false}
          height="400px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="Unique lines"
          value={result.text}
          placeholder="Deduplicated lines appear here"
          downloadName="unique-lines.txt"
          lineWrapping={false}
          height="400px"
          footer={
            input ? (
              <Counts
                items={[
                  { label: 'kept', value: result.kept, tone: 'success' },
                  { label: 'removed', value: result.removed, tone: result.removed ? 'danger' : undefined },
                ]}
              />
            ) : undefined
          }
        />
      </SplitPanes>
      {input && (
        <Panel
          title="Duplicated lines"
          description={
            result.duplicates.length
              ? `${formatNumber(result.duplicates.length, 0)} distinct lines appear more than once.`
              : 'No duplicates found with the current options.'
          }
        >
          {result.duplicates.length > 0 ? (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {result.duplicates.slice(0, 500).map((d) => (
                <li key={d.line} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate font-mono text-[13px] whitespace-pre text-fg">
                    {d.line.trim() === '' ? <span className="text-fg-muted italic">(blank line)</span> : d.line}
                  </span>
                  <Badge tone="warning">×{formatNumber(d.count, 0)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-muted">Every line is unique.</p>
          )}
        </Panel>
      )}
    </ToolStack>
  );
}
