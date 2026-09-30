import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { convertString, escapeString, ESCAPE_LANGUAGES, type EscapeLanguage, type EscapeOptions } from './lib/stringEscape';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, SampleButton, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';
import { t } from '@/lib/i18n';

const ID = 'string-escaper';
const SAMPLE = `He said "it's done"\n\tPath: C:\\Users\\me — ok? 😀`;

const WRAPPABLE: EscapeLanguage[] = ['json', 'js', 'java', 'c', 'sql'];
const ASCII_ONLY: EscapeLanguage[] = ['json', 'js', 'java'];

interface Settings extends EscapeOptions {
  lang: EscapeLanguage;
}

export default function StringEscaper() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [s, setS] = useToolState<Settings>(ID, 'settings', { lang: 'json', wrap: false, asciiOnly: false, quote: '"' });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const options = useMemo(() => ({ wrap: s.wrap, asciiOnly: s.asciiOnly, quote: s.quote }), [s.wrap, s.asciiOnly, s.quote]);
  const task = useTask('convertString', convertString, deferred ? [deferred, direction, s.lang, options] : null, { size: deferred.length });
  const result = task.value;
  const output = result?.ok ? result.text : '';
  const info = ESCAPE_LANGUAGES.find((l) => l.value === s.lang);

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  function loadSample() {
    setInput(direction === 'encode' ? SAMPLE : escapeString(SAMPLE, s.lang, { ...s, wrap: true }));
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
        <Opt label={t('Language / format')}>
          <Select value={s.lang} onChange={(e) => set('lang', e.target.value as EscapeLanguage)} aria-label={t('Language or format')} className="w-56">
            {ESCAPE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Opt>
        {direction === 'encode' && s.lang === 'js' && (
          <Opt label={t('Quote')}>
            <Segmented
              label={t('Quote character')}
              value={s.quote}
              onChange={(v) => set('quote', v)}
              options={[
                { value: '"', label: '"' },
                { value: "'", label: "'" },
                { value: '`', label: '`' },
              ]}
            />
          </Opt>
        )}
        {direction === 'encode' && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
            {WRAPPABLE.includes(s.lang) && <Switch label={t('Wrap in quotes')} checked={s.wrap} onChange={(v) => set('wrap', v)} />}
            {ASCII_ONLY.includes(s.lang) && <Switch label={t('Escape non-ASCII (\\uXXXX)')} checked={s.asciiOnly} onChange={(v) => set('asciiOnly', v)} />}
          </div>
        )}
        {info && <p className="w-full text-[12.5px] text-fg-muted">{info.hint}</p>}
      </ToolBar>
      <ErrorMessage error={result && !result.ok ? result.error : task.error} title={direction === 'encode' ? t('Cannot escape') : t('Cannot unescape')} />
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? t('Raw text') : t('Escaped string')}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? t('Text to turn into a string literal…') : t('Escaped string to decode (surrounding quotes are optional)…')}
          actions={<SampleButton onClick={loadSample} />}
          fileAccept={TEXT_FILE_ACCEPT}
          invalid={Boolean(result && !result.ok)}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={direction === 'encode' ? t('Escaped') : t('Unescaped')}
          value={output}
          placeholder={t('Result appears here')}
          downloadName={direction === 'encode' ? 'escaped.txt' : 'unescaped.txt'}
          height="320px"
          busy={task.pending}
          footer={<TextFooter text={output} />}
        />
      </SplitPanes>
    </ToolStack>
  );
}
