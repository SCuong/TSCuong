import { useDeferredValue } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { convertUnicodeEscapes, ESCAPE_FORMATS, type EscapeFormat, type EscapeScope } from './lib/unicodeEscape';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';

const ID = 'unicode-escape';
const SAMPLE_TEXT = 'Café “quotes” — 日本語 😀';
const SAMPLE_ESCAPED = String.raw`Caf\u00e9 \u201cquotes\u201d \u2014 \u{65E5}\u{672C}\u{8A9E} \ud83d\ude00 &#x2764; U+2728`;

interface Settings {
  format: EscapeFormat;
  scope: EscapeScope;
  uppercase: boolean;
  css: boolean;
}

export default function UnicodeEscape() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [s, setS] = useToolState<Settings>(ID, 'settings', { format: 'js', scope: 'nonAscii', uppercase: false, css: true });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const task = useTask('convertUnicodeEscapes', convertUnicodeEscapes, deferred ? [deferred, direction, s] : null, { size: deferred.length });
  const result = task.value;
  const output = result?.text ?? '';
  const example = ESCAPE_FORMATS.find((f) => f.value === s.format)?.example;

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls
          direction={direction}
          onDirection={setDirection}
          onSwap={swap}
          canSwap={Boolean(output) && !task.pending}
          labels={{ encode: 'Escape', decode: 'Unescape' }}
        />
        {direction === 'encode' ? (
          <>
            <Opt label="Format">
              <Select value={s.format} onChange={(e) => set('format', e.target.value as EscapeFormat)} aria-label="Escape format" className="w-48">
                {ESCAPE_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Opt>
            <Opt label="Escape">
              <Select value={s.scope} onChange={(e) => set('scope', e.target.value as EscapeScope)} aria-label="Characters to escape" className="w-56">
                <option value="nonAscii">Non-ASCII characters</option>
                <option value="nonPrintable">Non-ASCII + control chars</option>
                <option value="all">Every character</option>
              </Select>
            </Opt>
            <Switch label="Uppercase hex" checked={s.uppercase} onChange={(v) => set('uppercase', v)} className="pb-1.5" />
            {example && <p className="w-full font-mono text-[12.5px] text-fg-muted">Example: é 😀 → {example}</p>}
          </>
        ) : (
          <>
            <Switch label="Decode CSS escapes (\e9)" checked={s.css} onChange={(v) => set('css', v)} className="pb-1.5" />
            <p className="w-full text-[12.5px] text-fg-muted">
              Detects every style at once: \uXXXX (with surrogate pairs), \u{'{'}X{'}'}, \UXXXXXXXX, \xXX UTF-8 bytes, &amp;#xX;, &amp;#N;, U+XXXX and
              CSS escapes with two or more hex digits (\e9).
            </p>
          </>
        )}
      </ToolBar>
      <ErrorMessage error={task.error} title="Could not convert this text" />
      {result && result.warnings.length > 0 && (
        <Alert tone="warning" title="Check the result">
          <ul className="list-disc pl-4">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Text' : 'Escaped text'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'Text with Unicode characters…' : 'Text with \\u00e9, \\u{1F600}, &#x2764; or U+2728…'}
          sample={direction === 'encode' ? SAMPLE_TEXT : SAMPLE_ESCAPED}
          fileAccept={TEXT_FILE_ACCEPT}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={direction === 'encode' ? 'Escaped' : 'Unescaped'}
          value={output}
          placeholder="Result appears here"
          downloadName={direction === 'encode' ? 'escaped.txt' : 'unescaped.txt'}
          height="320px"
          busy={task.pending}
          footer={
            input && result ? (
              direction === 'decode' ? <span>{pluralize(result.count, 'escape')} decoded</span> : <TextFooter text={output} />
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
