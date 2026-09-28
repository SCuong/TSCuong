import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { NumberInput, Select, Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize } from '@/lib/utils';
import { cleanWhitespace, DEFAULT_WHITESPACE_OPTIONS, type WhitespaceOptions } from './lib/lines';
import { detectEol } from './lib/common';
import { Opt, TEXT_FILE_ACCEPT } from './components/shared';

const ID = 'whitespace-cleaner';
const SAMPLE = '   Leading spaces and trailing spaces   \n\tTabbed\tline\twith\ttabs\n\n\n\nToo    many     spaces   here.\u00a0No-break\u00a0space.   \r\nWindows line ending\n\n';

const EOL_NAMES = { '\n': 'LF', '\r\n': 'CRLF', '\r': 'CR' } as const;

export default function WhitespaceCleaner() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [opts, setOpts] = useToolState<WhitespaceOptions>(ID, 'options', DEFAULT_WHITESPACE_OPTIONS);
  const set = <K extends keyof WhitespaceOptions>(key: K, value: WhitespaceOptions[K]) => setOpts((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const result = useMemo(() => cleanWhitespace(deferred, opts), [deferred, opts]);
  const inputEol = input ? EOL_NAMES[detectEol(input)] : null;

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Trim lines">
          <Select value={opts.trim} onChange={(e) => set('trim', e.target.value as WhitespaceOptions['trim'])} aria-label="Trim lines" className="w-44">
            <option value="end">Trailing only</option>
            <option value="both">Both ends</option>
            <option value="start">Leading only</option>
            <option value="none">Don’t trim</option>
          </Select>
        </Opt>
        <Opt label="Empty lines">
          <Select value={opts.emptyLines} onChange={(e) => set('emptyLines', e.target.value as WhitespaceOptions['emptyLines'])} aria-label="Empty lines" className="w-44">
            <option value="keep">Keep</option>
            <option value="collapse">Collapse to one</option>
            <option value="remove">Remove all</option>
          </Select>
        </Opt>
        <Opt label="Tabs">
          <Select value={opts.tabs} onChange={(e) => set('tabs', e.target.value as WhitespaceOptions['tabs'])} aria-label="Tabs" className="w-48">
            <option value="keep">Keep</option>
            <option value="toSpaces">Tabs → spaces</option>
            <option value="toTabs">Leading spaces → tabs</option>
          </Select>
        </Opt>
        {opts.tabs !== 'keep' && (
          <Opt label="Tab width" className="w-24">
            <NumberInput
              value={opts.tabWidth}
              onChange={(v) => set('tabWidth', typeof v === 'number' ? Math.min(16, Math.max(1, Math.round(v))) : 4)}
              min={1}
              max={16}
              aria-label="Tab width"
            />
          </Opt>
        )}
        <Opt label="Line endings">
          <Select value={opts.lineEndings} onChange={(e) => set('lineEndings', e.target.value as WhitespaceOptions['lineEndings'])} aria-label="Line endings" className="w-44">
            <option value="keep">Keep{inputEol ? ` (${inputEol})` : ''}</option>
            <option value="lf">LF (Unix, macOS)</option>
            <option value="crlf">CRLF (Windows)</option>
            <option value="cr">CR (classic Mac)</option>
          </Select>
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Collapse spaces" checked={opts.collapseSpaces} onChange={(v) => set('collapseSpaces', v)} />
          <Switch label="Fix Unicode spaces" checked={opts.normalizeUnicodeSpaces} onChange={(v) => set('normalizeUnicodeSpaces', v)} />
          <Switch label="Trim document" checked={opts.trimDocument} onChange={(v) => set('trimDocument', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          placeholder="Paste messy text…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="420px"
          lineWrapping={false}
          footer={input ? <span>{pluralize(result.linesBefore, 'line')}</span> : undefined}
        />
        <EditorPanel
          title="Cleaned"
          value={result.text}
          placeholder="Cleaned text appears here"
          downloadName="cleaned.txt"
          height="420px"
          lineWrapping={false}
          footer={
            input ? (
              <>
                <span>{pluralize(result.linesAfter, 'line')}</span>
                <span>
                  {result.charsRemoved >= 0
                    ? `${formatNumber(result.charsRemoved, 0)} characters removed`
                    : `${formatNumber(-result.charsRemoved, 0)} characters added`}
                </span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
