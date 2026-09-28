import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize } from '@/lib/utils';
import { DEFAULT_FIND_OPTIONS, findAndReplace, type FindOptions } from './lib/findReplace';
import { HighlightedText, Opt, SampleButton, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'find-replace';
const SAMPLE = `Order #1042 shipped on 2024-03-15 to alice@example.com.
Order #1043 shipped on 2024-03-16 to bob@example.org.
Order #1044 is pending since 2024-03-17.`;

export default function FindReplace() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [find, setFind] = useToolState(ID, 'find', '');
  const [replacement, setReplacement] = useToolState(ID, 'replace', '');
  const [opts, setOpts] = useToolState<FindOptions>(ID, 'options', DEFAULT_FIND_OPTIONS);
  const set = <K extends keyof FindOptions>(key: K, value: FindOptions[K]) => setOpts((o) => ({ ...o, [key]: value }));

  const deferredInput = useDeferredValue(input);
  const result = useMemo(() => findAndReplace(deferredInput, find, replacement, opts), [deferredInput, find, replacement, opts]);
  const output = result.ok ? result.text : '';
  const ranges = result.ok ? result.ranges : [];
  const count = result.ok ? result.count : 0;

  function loadSample() {
    setInput(SAMPLE);
    if (!find) {
      setFind('(\\d{4})-(\\d{2})-(\\d{2})');
      setReplacement('$3/$2/$1');
      setOpts((o) => ({ ...o, regex: true }));
    }
  }

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
            aria-invalid={!result.ok || undefined}
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
          {find && result.ok && (
            <Badge tone={count ? 'accent' : 'neutral'} className="ml-auto">
              {count ? pluralize(count, 'match', 'matches') : 'No matches'}
            </Badge>
          )}
        </div>
      </ToolBar>
      <ErrorMessage error={result.ok ? null : result.error} />
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          placeholder="Paste the text to search…"
          fileAccept={TEXT_FILE_ACCEPT}
          height="360px"
          actions={
            <SampleButton onClick={loadSample} />
          }
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="Result"
          value={find ? output : input}
          placeholder="The replaced text appears here"
          downloadName="replaced.txt"
          height="360px"
          invalid={!result.ok}
          footer={input && find && result.ok ? <span>{`${formatNumber(count, 0)} replaced`}</span> : undefined}
        />
      </SplitPanes>
      {input && find && result.ok && (
        <Panel title="Matches" description="Highlighted in the input text." bodyClassName="p-3">
          <HighlightedText text={deferredInput} ranges={ranges} ariaLabel="Input with matches highlighted" />
        </Panel>
      )}
    </ToolStack>
  );
}
