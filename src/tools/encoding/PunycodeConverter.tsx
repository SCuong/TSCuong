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
          One domain or URL per line.{' '}
          {direction === 'encode'
            ? 'Uses the browser’s IDNA rules (lowercasing and full-width folding included).'
            : 'Decodes every xn-- label (RFC 3492) and checks it the way browsers do.'}
        </p>
      </ToolBar>
      <ErrorMessage error={task.error} title="Could not convert these domains" />
      {errors.length > 0 && (
        <Alert tone="danger" title={`${pluralize(errors.length, 'line')} could not be converted`}>
          <ul className="list-disc pl-4">
            {errors.slice(0, 5).map((r) => (
              <li key={r.line}>
                Line {r.line}: {r.error}
              </li>
            ))}
          </ul>
          {errors.length > 5 && <p className="mt-1">…and {pluralize(errors.length - 5, 'more line')}.</p>}
        </Alert>
      )}
      {warned.length > 0 && (
        <Alert tone="warning" title="Check these domains">
          <ul className="list-disc pl-4">
            {warned.slice(0, 5).flatMap((r) =>
              r.warnings.map((w) => (
                <li key={`${r.line}-${w}`}>
                  Line {r.line}: {w}
                </li>
              )),
            )}
          </ul>
          {warned.length > 5 && <p className="mt-1">…and {pluralize(warned.length - 5, 'more line')}.</p>}
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
        <OutputPanel
          title={direction === 'encode' ? 'Punycode (ASCII)' : 'Unicode'}
          value={deferred ? output : ''}
          placeholder="Result appears here"
          downloadName="domains.txt"
          height="300px"
          lineWrapping={false}
          busy={task.pending}
          footer={deferred && task.value ? <span>{pluralize(converted, 'domain')} converted</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
