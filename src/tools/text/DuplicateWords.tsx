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
    if (selectedWord) return selectedWord.positions.map((p) => ({ start: p.start, end: p.end, alt: true, title: `${selectedWord.word} (line ${p.line})` }));
    return result.consecutive.flatMap((d) => [
      { start: d.first.start, end: d.first.end, alt: true },
      { start: d.position.start, end: d.position.end, title: `Repeated “${d.word}” on line ${d.position.line}` },
    ]);
  }, [result, selectedWord]);

  function fix() {
    if (!current) return;
    setInput(removeConsecutiveDuplicates(analyzed, result.consecutive));
    toast(`Removed ${pluralize(result.consecutive.length, 'repeated word')}.`);
  }

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Min. length (repeated list)" className="w-44">
          <NumberInput
            value={o.minLength}
            onChange={(v) => set('minLength', typeof v === 'number' ? Math.max(1, Math.round(v)) : 1)}
            min={1}
            aria-label="Minimum word length for the repeated words list"
          />
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Match case" checked={o.caseSensitive} onChange={(v) => set('caseSensitive', v)} />
          <Switch label="Also across punctuation (“that, that”)" checked={!o.whitespaceOnly} onChange={(v) => set('whitespaceOnly', !v)} />
          <Switch label="Ignore common words in list" checked={o.excludeStopWords} onChange={(v) => set('excludeStopWords', v)} />
        </div>
      </ToolBar>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <EditorPanel
          title="Text"
          value={input}
          onChange={(v) => {
            setInput(v);
            setSelected(null);
          }}
          placeholder="Paste text to proofread for doubled words like “the the”…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="340px"
          footer={<TextFooter text={input} />}
        />
        <Panel
          title={selectedWord ? `Occurrences of “${selectedWord.word}”` : 'Doubled words'}
          description={
            selectedWord
              ? `${pluralize(selectedWord.count, 'occurrence')} highlighted.`
              : input
                ? result.consecutive.length
                  ? `${pluralize(result.consecutive.length, 'doubled word')} found.`
                  : 'No doubled words found.'
                : undefined
          }
          actions={
            <>
              {task.pending && <Spinner size={14} label="Checking…" />}
              {selectedWord ? (
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  Show doubled words
                </Button>
              ) : (
                <Button size="sm" icon={Eraser} onClick={fix} disabled={!current || result.consecutive.length === 0}>
                  Remove doubles
                </Button>
              )}
            </>
          }
          bodyClassName="p-3"
        >
          <ErrorMessage error={task.error} title="Could not check this text" />
          <HighlightedText text={analyzed} ranges={ranges} maxHeight="300px" emptyLabel="Highlighted text appears here." ariaLabel="Text with duplicates highlighted" />
          {!selectedWord && result.consecutive.length > 0 && (
            <ul className="mt-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" tabIndex={0} aria-label="Doubled words">
              {result.consecutive.slice(0, 200).map((d) => (
                <li key={d.position.start}>
                  <Badge tone="warning">
                    “{analyzed.slice(d.first.start, d.first.end)} {d.word}” · line {d.position.line}:{d.position.column}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {input && (
        <Panel
          title="Repeated words"
          description={
            result.repeated.length
              ? `Words used more than once across the text. Select one to highlight every occurrence.`
              : 'No word is used more than once with the current filters.'
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
