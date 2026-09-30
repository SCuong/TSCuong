import { useDeferredValue, useMemo, useState } from 'react';
import { Eraser } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { NumberInput, Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Feedback';
import { Badge, Panel } from '@/components/ui/Panel';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import {
  DEFAULT_DUPLICATE_OPTIONS,
  findDuplicateWords,
  removeConsecutiveDuplicates,
  type DuplicateWordOptions,
  type DuplicateWordResult,
} from './lib/duplicates';
import { HighlightedText, Opt, TEXT_FILE_ACCEPT, TextFooter, type HighlightRange } from './components/shared';
import { useTask } from './components/useTask';
import { t } from '@/lib/i18n';

const ID = 'duplicate-word-finder';
const EMPTY: DuplicateWordResult = { consecutive: [], repeated: [], totalWords: 0 };
const SAMPLE = `Paris in the
the spring is is lovely. Many readers never notice the the repeated word.
Writing clear sentences takes practice, and practice makes writing easier. Good writing is rewriting.`;

export default function DuplicateWords() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [o, setO] = useToolState<DuplicateWordOptions>(ID, 'options', DEFAULT_DUPLICATE_OPTIONS);
  const set = <K extends keyof DuplicateWordOptions>(key: K, value: DuplicateWordOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));
  const [selected, setSelected] = useState<string | null>(null);

  const deferred = useDeferredValue(input);
  const task = useTask('findDuplicateWords', findDuplicateWords, [deferred, o], { size: deferred.length });
  const result = task.value ?? EMPTY;
  // Positions refer to the text the result was computed from.
  const analyzed = task.args?.[0] ?? '';
  const current = !task.pending && analyzed === input;
  const selectedWord = result.repeated.find((r) => r.word === selected) ?? null;

  const ranges: HighlightRange[] = useMemo(() => {
    if (selectedWord) return selectedWord.positions.map((p) => ({ start: p.start, end: p.end, alt: true, title: t('{word} (line {line})', { word: selectedWord.word, line: p.line }) }));
    return result.consecutive.flatMap((d) => [
      { start: d.first.start, end: d.first.end, alt: true },
      { start: d.position.start, end: d.position.end, title: t('Repeated “{word}” on line {line}', { word: d.word, line: d.position.line }) },
    ]);
  }, [result, selectedWord]);

  function fix() {
    if (!current) return;
    setInput(removeConsecutiveDuplicates(analyzed, result.consecutive));
    toast(t('Removed {count}.', { count: pluralize(result.consecutive.length, t('repeated word'), t('repeated words')) }));
  }

  return (
    <ToolStack>
      <ToolBar>
        <Opt label={t('Min. length (repeated list)')} className="w-44">
          <NumberInput
            value={o.minLength}
            onChange={(v) => set('minLength', typeof v === 'number' ? Math.max(1, Math.round(v)) : 1)}
            min={1}
            aria-label={t('Minimum word length for the repeated words list')}
          />
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label={t('Match case')} checked={o.caseSensitive} onChange={(v) => set('caseSensitive', v)} />
          <Switch label={t('Also across punctuation (“that, that”)')} checked={!o.whitespaceOnly} onChange={(v) => set('whitespaceOnly', !v)} />
          <Switch label={t('Ignore common words in list')} checked={o.excludeStopWords} onChange={(v) => set('excludeStopWords', v)} />
        </div>
      </ToolBar>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <EditorPanel
          title={t('Text')}
          value={input}
          onChange={(v) => {
            setInput(v);
            setSelected(null);
          }}
          placeholder={t('Paste text to proofread for doubled words like “the the”…')}
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="340px"
          footer={<TextFooter text={input} />}
        />
        <Panel
          title={selectedWord ? t('Occurrences of “{word}”', { word: selectedWord.word }) : t('Doubled words')}
          description={
            selectedWord
              ? t('{count} highlighted.', { count: pluralize(selectedWord.count, t('occurrence'), t('occurrences')) })
              : input
                ? result.consecutive.length
                  ? t('{count} found.', { count: pluralize(result.consecutive.length, t('doubled word'), t('doubled words')) })
                  : t('No doubled words found.')
                : undefined
          }
          actions={
            <>
              {task.pending && <Spinner size={14} label={t('Checking…')} />}
              {selectedWord ? (
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  {t('Show doubled words')}
                </Button>
              ) : (
                <Button size="sm" icon={Eraser} onClick={fix} disabled={!current || result.consecutive.length === 0}>
                  {t('Remove doubles')}
                </Button>
              )}
            </>
          }
          bodyClassName="p-3"
        >
          <ErrorMessage error={task.error} title={t('Could not check this text')} />
          <HighlightedText text={analyzed} ranges={ranges} maxHeight="300px" emptyLabel={t('Highlighted text appears here.')} ariaLabel={t('Text with duplicates highlighted')} />
          {!selectedWord && result.consecutive.length > 0 && (
            <ul className="mt-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" tabIndex={0} aria-label={t('Doubled words')}>
              {result.consecutive.slice(0, 200).map((d) => (
                <li key={d.position.start}>
                  <Badge tone="warning">
                    {t('“{slice} {word}” · line {line}:{column}', { slice: analyzed.slice(d.first.start, d.first.end), word: d.word, line: d.position.line, column: d.position.column })}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {input && (
        <Panel
          title={t('Repeated words')}
          description={
            result.repeated.length
              ? t('Words used more than once across the text. Select one to highlight every occurrence.')
              : t('No word is used more than once with the current filters.')
          }
        >
          {result.repeated.length > 0 && (
            <div className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto">
              {result.repeated.slice(0, 300).map((r) => (
                <button
                  key={r.word}
                  type="button"
                  onClick={() => setSelected(selected === r.word ? null : r.word)}
                  aria-pressed={selected === r.word}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[13px] transition-colors',
                    selected === r.word
                      ? 'border-accent-line bg-accent-soft text-accent-text'
                      : 'border-line bg-surface-raised text-fg hover:bg-surface-hover',
                  )}
                >
                  <span className="font-medium">{r.word}</span>
                  <span className="font-mono text-[12px] text-fg-muted tabular-nums">×{formatNumber(r.count, 0)}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}
    </ToolStack>
  );
}
