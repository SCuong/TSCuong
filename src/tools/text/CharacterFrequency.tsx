import { useDeferredValue } from 'react';
import { ChartColumn } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { DownloadButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { charFrequency, DEFAULT_CHAR_FREQ_OPTIONS, frequencyToCsv, type CharFrequencyOptions } from './lib/frequency';
import { Counts, FrequencyTable, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { useTask } from './components/useTask';

const ID = 'character-frequency';
const SAMPLE = 'Hello, Wörld! 👋🏽 Ça va? Emoji like 👨‍👩‍👧 and flags 🇻🇳 count as one character each.';

export default function CharacterFrequency() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [o, setO] = useToolState<CharFrequencyOptions>(ID, 'options', DEFAULT_CHAR_FREQ_OPTIONS);
  const set = <K extends keyof CharFrequencyOptions>(key: K, value: CharFrequencyOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const task = useTask('charFrequency', charFrequency, [deferred, o], { size: deferred.length });
  const result = task.value;

  return (
    <ToolStack>
      <ToolBar>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-1">
          <Switch label="Include whitespace" checked={o.includeWhitespace} onChange={(v) => set('includeWhitespace', v)} />
          <Switch label="Ignore case" checked={o.caseFold} onChange={(v) => set('caseFold', v)} />
          <Switch label="Letters and digits only" checked={o.lettersOnly} onChange={(v) => set('lettersOnly', v)} />
        </div>
      </ToolBar>
      <ErrorMessage error={task.error} title="Could not count the characters" />
      <SplitPanes>
        <EditorPanel
          title="Text"
          value={input}
          onChange={setInput}
          placeholder="Paste text to count its characters…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="520px"
          footer={<TextFooter text={input} />}
        />
        <Panel
          title="Character frequency"
          description="Counts user-perceived characters, so emoji and accented letters count once."
          actions={
            <>
              {task.pending && <Spinner size={14} label="Counting…" />}
              <DownloadButton
                data={() => frequencyToCsv(result?.rows ?? [], 'character')}
                filename="character-frequency.csv"
                type="text/csv;charset=utf-8"
                label="CSV"
                disabled={!result || result.rows.length === 0}
              />
            </>
          }
        >
          {!result ? (
            task.pending ? (
              <Spinner label="Counting characters…" className="p-2" />
            ) : (
              <EmptyState icon={ChartColumn} title="No text yet">
                Each character, its code point and share appear here.
              </EmptyState>
            )
          ) : result.rows.length === 0 ? (
            <EmptyState icon={ChartColumn} title={input ? 'Nothing to count with these filters' : 'No text yet'}>
              {input ? 'Turn on “Include whitespace” or allow punctuation.' : 'Each character, its code point and share appear here.'}
            </EmptyState>
          ) : (
            <div className="flex max-h-[520px] flex-col gap-3">
              <Counts
                items={[
                  { label: 'characters counted', value: result.total },
                  { label: 'distinct', value: result.unique, tone: 'accent' },
                ]}
              />
              <div className="min-h-0 overflow-y-auto" tabIndex={0} role="region" aria-label="Character frequency table">
                <FrequencyTable rows={result.rows} itemHeader="Character" mode="char" />
              </div>
            </div>
          )}
        </Panel>
      </SplitPanes>
    </ToolStack>
  );
}
