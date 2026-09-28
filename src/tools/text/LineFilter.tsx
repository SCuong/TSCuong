import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Select, Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { filterLines, type FilterCondition, type FilterOptions } from './lib/lines';
import { Counts, Opt, SampleButton, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'line-filter';
const SAMPLE = `2024-05-01 10:00:01 INFO  Server started on port 8080
2024-05-01 10:00:05 DEBUG Loading configuration
2024-05-01 10:01:12 ERROR Database connection refused
2024-05-01 10:01:13 WARN  Retrying in 5 seconds
2024-05-01 10:01:18 INFO  Connected to database

2024-05-01 10:05:40 ERROR Request timeout on /api/users`;

const DEFAULTS: FilterOptions = { action: 'keep', condition: 'contains', term: '', caseSensitive: false, wholeWord: false };

const CONDITIONS: Array<{ value: FilterCondition; label: string }> = [
  { value: 'contains', label: 'Contain' },
  { value: 'startsWith', label: 'Start with' },
  { value: 'endsWith', label: 'End with' },
  { value: 'equals', label: 'Are exactly' },
  { value: 'regex', label: 'Match regex' },
  { value: 'empty', label: 'Are empty' },
];

export default function LineFilter() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [o, setO] = useToolState<FilterOptions>(ID, 'options', DEFAULTS);
  const set = <K extends keyof FilterOptions>(key: K, value: FilterOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const active = o.condition === 'empty' || o.term !== '';
  const result = useMemo(() => (active ? filterLines(deferred, o) : null), [deferred, o, active]);

  function loadSample() {
    setInput(SAMPLE);
    if (!o.term) setO((prev) => ({ ...prev, term: 'ERROR', condition: 'contains' }));
  }

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Action">
          <Segmented
            label="Action"
            value={o.action}
            onChange={(v) => set('action', v)}
            options={[
              { value: 'keep', label: 'Keep lines that' },
              { value: 'remove', label: 'Remove lines that' },
            ]}
          />
        </Opt>
        <Opt label="Condition">
          <Select value={o.condition} onChange={(e) => set('condition', e.target.value as FilterCondition)} aria-label="Condition" className="w-40">
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Opt>
        {o.condition !== 'empty' && (
          <Opt label={o.condition === 'regex' ? 'Pattern' : 'Text'} className="min-w-48 flex-1">
            <Input
              value={o.term}
              onChange={(e) => set('term', e.target.value)}
              mono
              placeholder={o.condition === 'regex' ? 'e.g. ^\\d{4}-' : 'e.g. ERROR'}
              aria-label={o.condition === 'regex' ? 'Regular expression' : 'Filter text'}
              aria-invalid={(result && !result.ok) || undefined}
            />
          </Opt>
        )}
        {o.condition !== 'empty' && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
            <Switch label="Match case" checked={o.caseSensitive} onChange={(v) => set('caseSensitive', v)} />
            {o.condition !== 'regex' && <Switch label="Whole word" checked={o.wholeWord} onChange={(v) => set('wholeWord', v)} />}
          </div>
        )}
      </ToolBar>
      <ErrorMessage error={result && !result.ok ? result.error : null} />
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          placeholder="Paste lines, a log file or a list…"
          fileAccept={TEXT_FILE_ACCEPT}
          height="420px"
          lineWrapping={false}
          actions={<SampleButton onClick={loadSample} />}
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="Filtered"
          value={result?.ok ? result.text : active ? '' : input}
          placeholder={active ? 'No lines left after filtering' : 'Enter a filter to see the result'}
          downloadName="filtered.txt"
          height="420px"
          lineWrapping={false}
          footer={
            input && result?.ok ? (
              <Counts
                items={[
                  { label: 'matched', value: result.matched, tone: 'accent' },
                  { label: 'kept', value: result.kept, tone: 'success' },
                  { label: 'removed', value: result.total - result.kept },
                ]}
              />
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
