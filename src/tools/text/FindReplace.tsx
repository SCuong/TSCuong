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
import { t } from '@/lib/i18n';

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
        <Opt label={t('Find')} className="min-w-52 flex-1">
          <Input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            mono
            placeholder={opts.regex ? t('Regular expression, e.g. (\\w+)@(\\w+)') : t('Text to find')}
            aria-label={t('Find')}
            aria-invalid={Boolean(patternError) || undefined}
          />
        </Opt>
        <Opt label={t('Replace with')} className="min-w-52 flex-1">
          <Input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            mono
            placeholder={opts.regex ? t('Use $1, $2 or $<name> for groups') : t('Replacement text')}
            aria-label={t('Replace with')}
          />
        </Opt>
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-2">
          <Switch label={t('Regex')} checked={opts.regex} onChange={(v) => set('regex', v)} />
          <Switch label={t('Match case')} checked={opts.caseSensitive} onChange={(v) => set('caseSensitive', v)} />
          <Switch label={t('Whole word')} checked={opts.wholeWord} onChange={(v) => set('wholeWord', v)} />
          {opts.regex && (
            <>
              <Switch label={t('^ $ per line')} checked={opts.multiline} onChange={(v) => set('multiline', v)} />
              <Switch label={t('. matches newline')} checked={opts.dotAll} onChange={(v) => set('dotAll', v)} />
            </>
          )}
          <Switch label={t('\\n \\t in replacement')} checked={opts.escapes} onChange={(v) => set('escapes', v)} />
          <span className="ml-auto flex items-center gap-2">
            {task.pending && <Spinner size={14} label={t('Searching…')} />}
            {showResult && result && !task.pending && (
              <Badge tone={result.count ? 'accent' : 'neutral'}>{result.count ? pluralize(result.count, t('match'), t('matches')) : t('No matches')}</Badge>
            )}
          </span>
        </div>
      </ToolBar>
      <ErrorMessage error={failure} title={patternError ? t('Invalid pattern') : undefined} />
      {task.timedOut && <RegexTimeoutAlert size={deferredInput.length} />}
      <SplitPanes>
        <EditorPanel
          title={t('Input')}
          value={input}
          onChange={setInput}
          placeholder={t('Paste the text to search…')}
          fileAccept={TEXT_FILE_ACCEPT}
          height="360px"
          actions={<SampleButton onClick={loadSample} />}
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={t('Result')}
          value={!find ? deferredInput : showResult && result ? result.text : ''}
          placeholder={find && (failure || task.timedOut) ? t('Fix the search to see the result') : t('The replaced text appears here')}
          downloadName="replaced.txt"
          height="360px"
          invalid={Boolean(failure) || task.timedOut}
          busy={task.pending}
          footer={input && showResult && result ? <span>{t('{count} replaced', { count: formatNumber(result.count, 0) })}</span> : undefined}
        />
      </SplitPanes>
      {input && showResult && result && (
        <Panel title={t('Matches')} description={t('Highlighted in the input text.')} bodyClassName="p-3">
          <HighlightedText text={searchedText} ranges={result.ranges} ariaLabel={t('Input with matches highlighted')} />
        </Panel>
      )}
    </ToolStack>
  );
}
