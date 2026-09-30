import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { Badge, Panel } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize } from '@/lib/utils';
import { compileSearch, DEFAULT_FIND_OPTIONS, findAndReplace, type FindOptions } from './lib/findReplace';
import { HighlightedText, Opt, SampleButton, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { OutputPanel } from './components/OutputPanel';
import { regexTimeoutMs, RegexTimeoutAlert } from './components/RegexTimeout';
import { useTask } from './components/useTask';

const ID = 'find-replace';
const SAMPLE = `Order #1042 shipped on 2024-03-15 to alice@example.com.
Order #1043 shipped on 2024-03-16 to bob@example.org.
Order #1044 is pending since 2024-03-17.`;
/** One more than the highlighter shows, so it can say that only the first 5,000 are highlighted. */
const MAX_RANGES = 5_001;

export default function FindReplace() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [find, setFind] = useToolState(ID, 'find', '');
  const [replacement, setReplacement] = useToolState(ID, 'replace', '');
  const [opts, setOpts] = useToolState<FindOptions>(ID, 'options', DEFAULT_FIND_OPTIONS);
  const set = <K extends keyof FindOptions>(key: K, value: FindOptions[K]) => setOpts((o) => ({ ...o, [key]: value }));

  const deferredInput = useDeferredValue(input);
  // Compiling is instant and safe; only matching can run away, so it happens in a worker.
  const compiled = useMemo(() => (find ? compileSearch(find, opts) : null), [find, opts]);
  const patternError = compiled && !compiled.ok ? compiled.error : null;
  const task = useTask(
    'findAndReplace',
    findAndReplace,
    find && compiled?.ok ? [deferredInput, find, replacement, opts, MAX_RANGES] : null,
    { size: deferredInput.length, timeoutMs: opts.regex ? regexTimeoutMs(deferredInput.length) : undefined },
  );
  const result = task.value?.ok ? task.value : null;
  const searchedText = task.args?.[0] ?? '';
  const failure = patternError ?? (task.value && !task.value.ok ? task.value.error : task.error);

  function loadSample() {
    setInput(SAMPLE);
    if (!find) {
      setFind('(\\d{4})-(\\d{2})-(\\d{2})');
      setReplacement('$3/$2/$1');
      setOpts((o) => ({ ...o, regex: true }));
    }
  }

  const showResult = Boolean(find && !failure && !task.timedOut);

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Find" className="min-w-52 flex-1">
          <Input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            mono
            placeholder={opts.regex ? 'Regular expression, e.g. (\\w+)@(\\w+)' : 'Text to find'}
            aria-label="Find"
            aria-invalid={Boolean(patternError) || undefined}
          />
        </Opt>
        <Opt label="Replace with" className="min-w-52 flex-1">
          <Input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            mono
            placeholder={opts.regex ? 'Use $1, $2 or $<name> for groups' : 'Replacement text'}
            aria-label="Replace with"
          />
        </Opt>
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-2">
          <Switch label="Regex" checked={opts.regex} onChange={(v) => set('regex', v)} />
          <Switch label="Match case" checked={opts.caseSensitive} onChange={(v) => set('caseSensitive', v)} />
          <Switch label="Whole word" checked={opts.wholeWord} onChange={(v) => set('wholeWord', v)} />
          {opts.regex && (
            <>
              <Switch label="^ $ per line" checked={opts.multiline} onChange={(v) => set('multiline', v)} />
              <Switch label=". matches newline" checked={opts.dotAll} onChange={(v) => set('dotAll', v)} />
            </>
          )}
          <Switch label="\n \t in replacement" checked={opts.escapes} onChange={(v) => set('escapes', v)} />
          <span className="ml-auto flex items-center gap-2">
            {task.pending && <Spinner size={14} label="Searching…" />}
            {showResult && result && !task.pending && (
              <Badge tone={result.count ? 'accent' : 'neutral'}>{result.count ? pluralize(result.count, 'match', 'matches') : 'No matches'}</Badge>
            )}
          </span>
        </div>
      </ToolBar>
      <ErrorMessage error={failure} title={patternError ? 'Invalid pattern' : undefined} />
      {task.timedOut && <RegexTimeoutAlert size={deferredInput.length} />}
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          placeholder="Paste the text to search…"
          fileAccept={TEXT_FILE_ACCEPT}
          height="360px"
          actions={<SampleButton onClick={loadSample} />}
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title="Result"
          value={!find ? deferredInput : showResult && result ? result.text : ''}
          placeholder={find && (failure || task.timedOut) ? 'Fix the search to see the result' : 'The replaced text appears here'}
          downloadName="replaced.txt"
          height="360px"
          invalid={Boolean(failure) || task.timedOut}
          busy={task.pending}
          footer={input && showResult && result ? <span>{`${formatNumber(result.count, 0)} replaced`}</span> : undefined}
        />
      </SplitPanes>
      {input && showResult && result && (
        <Panel title="Matches" description="Highlighted in the input text." bodyClassName="p-3">
          <HighlightedText text={searchedText} ranges={result.ranges} ariaLabel="Input with matches highlighted" />
        </Panel>
      )}
    </ToolStack>
  );
}
