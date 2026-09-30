import { useDeferredValue } from 'react';
import { ChartColumn } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { NumberInput, Switch } from '@/components/ui/Field';
import { DownloadButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { DEFAULT_WORD_FREQ_OPTIONS, frequencyToCsv, wordFrequency, type WordFrequencyOptions } from './lib/frequency';
import { Counts, FrequencyTable, Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { useTask } from './components/useTask';
import { t } from '@/lib/i18n';

const ID = 'word-frequency';
const SAMPLE = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair.`;

export default function WordFrequency() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [o, setO] = useToolState<WordFrequencyOptions>(ID, 'options', DEFAULT_WORD_FREQ_OPTIONS);
  const set = <K extends keyof WordFrequencyOptions>(key: K, value: WordFrequencyOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const task = useTask('wordFrequency', wordFrequency, [deferred, o], { size: deferred.length });
  const result = task.value;

  return (
    <ToolStack>
      <ToolBar>
        <Opt label={t('Minimum length')} className="w-32">
          <NumberInput
            value={o.minLength}
            onChange={(v) => set('minLength', typeof v === 'number' ? Math.max(1, Math.round(v)) : 1)}
            min={1}
            aria-label={t('Minimum word length')}
          />
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label={t('Ignore common words (the, and, of…)')} checked={o.excludeStopWords} onChange={(v) => set('excludeStopWords', v)} />
          <Switch label={t('Ignore case')} checked={o.caseFold} onChange={(v) => set('caseFold', v)} />
          <Switch label={t('Include numbers')} checked={o.includeNumbers} onChange={(v) => set('includeNumbers', v)} />
        </div>
      </ToolBar>
      <ErrorMessage error={task.error} title={t('Could not count the words')} />
      <SplitPanes>
        <EditorPanel
          title={t('Text')}
          value={input}
          onChange={setInput}
          placeholder={t('Paste an article, essay or any text…')}
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="520px"
          footer={<TextFooter text={input} />}
        />
        <Panel
          title={t('Word frequency')}
          actions={
            <>
              {task.pending && <Spinner size={14} label={t('Counting…')} />}
              <DownloadButton
                data={() => frequencyToCsv(result?.rows ?? [], 'word')}
                filename="word-frequency.csv"
                type="text/csv;charset=utf-8"
                label="CSV"
                disabled={!result || result.rows.length === 0}
              />
            </>
          }
        >
          {!result ? (
            task.pending ? (
              <Spinner label={t('Counting words…')} className="p-2" />
            ) : (
              <EmptyState icon={ChartColumn} title={t('No text yet')}>
                {t('Word counts and percentages appear here as you type.')}
              </EmptyState>
            )
          ) : result.rows.length === 0 ? (
            <EmptyState icon={ChartColumn} title={input.trim() ? t('No words match the filters') : t('No text yet')}>
              {input.trim() ? t('Try lowering the minimum length or including common words.') : t('Word counts and percentages appear here as you type.')}
            </EmptyState>
          ) : (
            <div className="flex max-h-[520px] flex-col gap-3">
              <Counts
                items={[
                  { label: t('words counted'), value: result.total },
                  { label: 'unique', value: result.unique, tone: 'accent' },
                ]}
              />
              <div className="min-h-0 overflow-y-auto" tabIndex={0} role="region" aria-label={t('Word frequency table')}>
                <FrequencyTable rows={result.rows} itemHeader={t('Word')} />
              </div>
            </div>
          )}
        </Panel>
      </SplitPanes>
    </ToolStack>
  );
}
