import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { domainToAscii, domainToUnicode, mixedScriptLabels } from './lib/punycode';
import { DirectionControls, type Direction } from './components/shared';
import { TEXT_FILE_ACCEPT } from '../text/components/shared';

const ID = 'punycode-converter';
const SAMPLE_UNICODE = 'bücher.example\nmünchen.de\nhttps://日本語.jp/path?q=1\n例え.テスト\nаpple.com';
const SAMPLE_ASCII = 'xn--bcher-kva.example\nxn--mnchen-3ya.de\nhttps://xn--wgv71a119e.jp/path?q=1\nxn--r8jz45g.xn--zckzah';

export default function PunycodeConverter() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');

  const deferred = useDeferredValue(input);
  const rows = useMemo(
    () =>
      deferred.split(/\r\n|\r|\n/).map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return { line: i + 1, input: line, output: '', error: null as string | null, warning: null as string | null };
        const r = direction === 'encode' ? domainToAscii(trimmed) : domainToUnicode(trimmed);
        const unicodeForm = direction === 'encode' ? trimmed : r.ok ? r.value : '';
        const suspicious = unicodeForm ? mixedScriptLabels(unicodeForm.replace(/^[a-z]+:\/\/|[/?#].*$/gi, '')) : [];
        return {
          line: i + 1,
          input: trimmed,
          output: r.ok ? r.value : '',
          error: r.ok ? null : r.error,
          warning: suspicious.length ? `“${suspicious.join('”, “')}” mixes Latin with Cyrillic or Greek letters, a common look-alike (homograph) trick.` : null,
        };
      }),
    [deferred, direction],
  );
  const output = deferred ? rows.map((r) => r.output).join('\n') : '';
  const errors = rows.filter((r) => r.error);
  const warnings = rows.filter((r) => r.warning);
  const converted = rows.filter((r) => r.output).length;

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
          canSwap={Boolean(output.trim())}
          labels={{ encode: 'Unicode → Punycode', decode: 'Punycode → Unicode' }}
        />
        <p className="pb-2 text-[12.5px] text-fg-muted">
          One domain or URL per line. {direction === 'encode' ? 'Uses the browser’s IDNA rules (lowercasing and full-width folding included).' : 'Decodes every xn-- label (RFC 3492).'}
        </p>
      </ToolBar>
      {errors.length > 0 && (
        <Alert tone="danger" title={`${pluralize(errors.length, 'line')} could not be converted`}>
          <ul className="list-disc pl-4">
            {errors.slice(0, 5).map((r) => (
              <li key={r.line}>
                Line {r.line}: {r.error}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert tone="warning" title="Possible look-alike domain">
          <ul className="list-disc pl-4">
            {warnings.slice(0, 5).map((r) => (
              <li key={r.line}>
                Line {r.line}: {r.warning}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? 'Unicode domains' : 'Punycode (xn--) domains'}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? 'bücher.example' : 'xn--bcher-kva.example'}
          sample={direction === 'encode' ? SAMPLE_UNICODE : SAMPLE_ASCII}
          fileAccept={TEXT_FILE_ACCEPT}
          height="300px"
          lineWrapping={false}
          invalid={errors.length > 0}
          footer={deferred ? <span>{pluralize(rows.filter((r) => r.input.trim()).length, 'line')}</span> : undefined}
        />
        <EditorPanel
          title={direction === 'encode' ? 'Punycode (ASCII)' : 'Unicode'}
          value={output}
          placeholder="Result appears here"
          downloadName="domains.txt"
          height="300px"
          lineWrapping={false}
          footer={deferred ? <span>{pluralize(converted, 'domain')} converted</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
