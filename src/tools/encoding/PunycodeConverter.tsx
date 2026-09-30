import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { convertDomains, type DomainRow } from './lib/punycode';
import { DirectionControls, type Direction } from './components/shared';
import { TEXT_FILE_ACCEPT } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';
import { t } from '@/lib/i18n';

const ID = 'punycode-converter';
const SAMPLE_UNICODE = 'bücher.example\nmünchen.de\nhttps://日本語.jp/path?q=1\n例え.テスト\nаpple.com';
const SAMPLE_ASCII = 'xn--bcher-kva.example\nxn--mnchen-3ya.de\nhttps://xn--wgv71a119e.jp/path?q=1\nxn--r8jz45g.xn--zckzah';
const NO_ROWS: DomainRow[] = [];

export default function PunycodeConverter() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'encode');

  const deferred = useDeferredValue(input);
  const task = useTask('convertDomains', convertDomains, deferred ? [deferred, direction] : null, { size: deferred.length });
  const rows = task.value ?? NO_ROWS;
  const output = useMemo(() => rows.map((r) => r.output).join('\n'), [rows]);
  const errors = rows.filter((r) => r.error);
  const warned = rows.filter((r) => r.warnings.length > 0);
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
          canSwap={Boolean(output.trim()) && !task.pending}
          labels={{ encode: 'Unicode → Punycode', decode: 'Punycode → Unicode' }}
        />
        <p className="pb-2 text-[12.5px] text-fg-muted">
          {t('One domain or URL per line.')}{' '}
          {direction === 'encode'
            ? t('Uses the browser’s IDNA rules (lowercasing and full-width folding included).')
            : t('Decodes every xn-- label (RFC 3492) and checks it the way browsers do.')}
        </p>
      </ToolBar>
      <ErrorMessage error={task.error} title={t('Could not convert these domains')} />
      {errors.length > 0 && (
        <Alert tone="danger" title={t('{count} could not be converted', { count: pluralize(errors.length, t('line'), t('lines')) })}>
          <ul className="list-disc pl-4">
            {errors.slice(0, 5).map((r) => (
              <li key={r.line}>
                {t('Line {line}: {error}', { line: r.line, error: r.error })}
              </li>
            ))}
          </ul>
          {errors.length > 5 && <p className="mt-1">{t('…and {count}.', { count: pluralize(errors.length - 5, t('more line'), t('more lines')) })}</p>}
        </Alert>
      )}
      {warned.length > 0 && (
        <Alert tone="warning" title={t('Check these domains')}>
          <ul className="list-disc pl-4">
            {warned.slice(0, 5).flatMap((r) =>
              r.warnings.map((w) => (
                <li key={`${r.line}-${w}`}>
                  {t('Line {line}: {w}', { line: r.line, w })}
                </li>
              )),
            )}
          </ul>
          {warned.length > 5 && <p className="mt-1">{t('…and {count}.', { count: pluralize(warned.length - 5, t('more line'), t('more lines')) })}</p>}
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title={direction === 'encode' ? t('Unicode domains') : t('Punycode (xn--) domains')}
          value={input}
          onChange={setInput}
          placeholder={direction === 'encode' ? t('bücher.example') : t('xn--bcher-kva.example')}
          sample={direction === 'encode' ? SAMPLE_UNICODE : SAMPLE_ASCII}
          fileAccept={TEXT_FILE_ACCEPT}
          height="300px"
          lineWrapping={false}
          invalid={errors.length > 0}
          footer={deferred ? <span>{pluralize(rows.filter((r) => r.input.trim()).length, t('line'), t('lines'))}</span> : undefined}
        />
        <OutputPanel
          title={direction === 'encode' ? t('Punycode (ASCII)') : t('Unicode')}
          value={deferred ? output : ''}
          placeholder={t('Result appears here')}
          downloadName="domains.txt"
          height="300px"
          lineWrapping={false}
          busy={task.pending}
          footer={deferred && task.value ? <span>{t('{count} converted', { count: pluralize(converted, t('domain'), t('domains')) })}</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
