import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { urlDecode, urlDecodeLenient, urlEncode, type UrlEncodeMode } from './lib/url';
import { DirectionControls, type Direction } from './components/shared';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';

const ID = 'url-encoder';
const SAMPLE_ENCODE = 'name=Jürgen Müller&city=São Paulo&q=café & crème 100%';
const SAMPLE_DECODE = 'https://example.com/search?q=caf%C3%A9%20%26%20cr%C3%A8me&city=S%C3%A3o+Paulo&emoji=%F0%9F%98%80';

const MODE_HELP: Record<UrlEncodeMode, string> = {
  component: 'encodeURIComponent: for a single query value or path segment. Encodes / ? & = # and spaces (as %20).',
  uri: 'encodeURI: for a whole URL. Keeps : / ? & = # so the URL stays usable; only encodes spaces and non-ASCII.',
  form: 'application/x-www-form-urlencoded: like encodeURIComponent, but spaces become + (HTML form submissions).',
};

interface Settings {
  mode: UrlEncodeMode;
  strict: boolean;
  perLine: boolean;
  plusAsSpace: boolean;
  lenient: boolean;
}

export default function UrlEncoder() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');
  const [s, setS] = useToolState<Settings>(ID, 'settings', { mode: 'component', strict: false, perLine: false, plusAsSpace: true, lenient: false });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  // Form data always encodes spaces as "+", so decoding it must turn "+" back into spaces.
  const plusAsSpace = s.mode === 'form' || s.plusAsSpace;
  const result = useMemo(() => {
    if (!deferred) return null;
    if (direction === 'encode') return urlEncode(deferred, s);
    const decodeMode = s.mode === 'uri' ? 'uri' : 'component';
    const strict = urlDecode(deferred, { plusAsSpace, mode: decodeMode });
    if (!strict.ok && s.lenient) return { ok: true as const, text: urlDecodeLenient(deferred, plusAsSpace, decodeMode) };
    return strict;
  }, [deferred, direction, s, plusAsSpace]);
  const output = result?.ok ? result.text : '';

  function swap() {
    setInput(output);
    setDirection(direction === 'encode' ? 'decode' : 'encode');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionControls direction={direction} onDirection={setDirection} onSwap={swap} canSwap={Boolean(output)} />
        <Opt label={direction === 'encode' ? 'Encoding' : 'Decoding'}>
          <Select value={s.mode} onChange={(e) => set('mode', e.target.value as UrlEncodeMode)} aria-label="Encoding type" className="w-56">
            <option value="component">URI component</option>
            <option value="uri">Full URL</option>
            <option value="form">Form data (+ for space)</option>
          </Select>
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          {direction === 'encode' ? (
            <>
              {s.mode !== 'uri' && <Switch label="Also encode ! ' ( ) *" checked={s.strict} onChange={(v) => set('strict', v)} />}
              <Switch label="Encode each line separately" checked={s.perLine} onChange={(v) => set('perLine', v)} />
            </>
          ) : (
            <>
              <Switch
                label="Treat + as space"
                checked={plusAsSpace}
                onChange={(v) => set('plusAsSpace', v)}
                disabled={s.mode === 'form'}
              />
              <Switch label="Skip malformed sequences" checked={s.lenient} onChange={(v) => set('lenient', v)} />
            </>
          )}
        </div>
        <p className="w-full text-[12.5px] text-fg-muted">
          {direction === 'encode'
            ? MODE_HELP[s.mode]
            : s.mode === 'uri'
              ? 'decodeURI leaves reserved characters such as %2F and %3F encoded, so the URL structure is preserved.'
              : s.mode === 'form'
                ? 'Decodes every %XX sequence as UTF-8 and every + as a space (form submissions).'
                : 'Decodes every %XX sequence as UTF-8.'}
        </p>
      </ToolBar>
      <ErrorMessage error={result && !result.ok ? result.error : null} title={direction === 'encode' ? 'Cannot encode' : 'Cannot decode'} />
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Text' : 'Encoded'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'Text or URL to encode…' : 'Percent-encoded text or URL to decode…'}
          sample={direction === 'encode' ? SAMPLE_ENCODE : SAMPLE_DECODE}
          fileAccept={TEXT_FILE_ACCEPT}
          invalid={Boolean(result && !result.ok)}
          height="320px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={direction === 'encode' ? 'Encoded' : 'Decoded'}
          value={output}
          placeholder="Result appears here"
          downloadName={direction === 'encode' ? 'encoded.txt' : 'decoded.txt'}
          height="320px"
          footer={<TextFooter text={output} />}
        />
      </SplitPanes>
    </ToolStack>
  );
}
