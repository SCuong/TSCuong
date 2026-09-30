import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize } from '@/lib/utils';
import { codePointLabel } from './lib/common';
import { analyzeNormalization, type NormalForm, type NormalizationReport } from './lib/normalize';
import { HighlightedText, Opt, TEXT_FILE_ACCEPT } from './components/shared';
import { OutputPanel } from './components/OutputPanel';
import { useTask } from './components/useTask';

const ID = 'unicode-normalizer';
const EMPTY_REPORT: NormalizationReport = analyzeNormalization('', { form: 'none', removeDiacritics: false });
// Decomposed "é" (e + U+0301), a ligature, full-width letters, a circled digit and superscript.
const SAMPLE = 'Café ﬁnance: Ｆｕｌｌ-width ①②, x² and Å (U+212B). Tiếng Việt, Ελληνικά.';

const FORM_HELP: Record<NormalForm, string> = {
  NFC: 'Composed: é is one code point. The web standard and the right choice for storage and comparison.',
  NFD: 'Decomposed: é becomes e + combining accent. Used by macOS file names.',
  NFKC: 'Compatibility composed: also folds look-alikes (ﬁ → fi, ① → 1, Ｆ → F). Good for search and identifiers.',
  NFKD: 'Compatibility decomposed: NFKC folding plus separate accent marks.',
  none: 'No normalization; only the diacritics option applies.',
};

export default function UnicodeNormalizer() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [form, setForm] = useToolState<NormalForm>(ID, 'form', 'NFC');
  const [strip, setStrip] = useToolState(ID, 'removeDiacritics', false);

  const deferred = useDeferredValue(input);
  const opts = useMemo(() => ({ form, removeDiacritics: strip }), [form, strip]);
  const task = useTask('analyzeNormalization', analyzeNormalization, [deferred, opts], { size: deferred.length });
  const report = task.value ?? EMPTY_REPORT;
  const analyzedText = task.args?.[0] ?? '';
  const partial = analyzedText.length > report.analyzedChars;

  const rows: Array<[string, number, number]> = [
    ['Code points', report.before.codePoints, report.after.codePoints],
    ['UTF-16 units', report.before.utf16, report.after.utf16],
    ['UTF-8 bytes', report.before.bytes, report.after.bytes],
    ['Graphemes', report.before.graphemes, report.after.graphemes],
  ];

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Normalization form">
          <Segmented
            label="Normalization form"
            value={form}
            onChange={setForm}
            options={[
              { value: 'NFC', label: 'NFC' },
              { value: 'NFD', label: 'NFD' },
              { value: 'NFKC', label: 'NFKC' },
              { value: 'NFKD', label: 'NFKD' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Opt>
        <Switch label="Remove diacritics (é → e)" checked={strip} onChange={setStrip} className="pb-1.5" />
        <p className="w-full text-[12.5px] text-fg-muted">{FORM_HELP[form]}</p>
      </ToolBar>
      <ErrorMessage error={task.error} title="Could not normalize this text" />
      <SplitPanes>
        <EditorPanel title="Input" value={input} onChange={setInput} placeholder="Paste text to normalize…" sample={SAMPLE} fileAccept={TEXT_FILE_ACCEPT} height="260px" />
        <OutputPanel
          title="Normalized"
          value={report.output}
          placeholder="Normalized text appears here"
          downloadName="normalized.txt"
          height="260px"
          busy={task.pending}
        />
      </SplitPanes>
      {input && task.value && (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="Before → after" bodyClassName="px-4 py-2">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-fg-muted">
                  <th scope="col" className="py-1.5 font-medium">Measure</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Before</th>
                  <th scope="col" className="py-1.5 text-right font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(([label, b, a]) => (
                  <tr key={label}>
                    <td className="py-1.5 text-fg-secondary">{label}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatNumber(b, 0)}</td>
                    <td className={`py-1.5 text-right font-mono tabular-nums ${a !== b ? 'text-accent-text' : ''}`}>{formatNumber(a, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[12.5px] text-fg-muted">
              {report.output === analyzedText
                ? form === 'none' && !strip
                  ? 'Nothing to do: choose a form or remove diacritics.'
                  : 'The text is already in this form.'
                : partial
                  ? `${pluralize(report.changed, 'character')} changed in the first ${formatNumber(report.analyzedChars, 0)} characters.`
                  : `${pluralize(report.changed, 'character')} changed.`}
            </p>
          </Panel>
          <Panel
            title="Changed characters"
            description={
              report.changed
                ? partial
                  ? `Highlighted in the first ${formatNumber(report.analyzedChars, 0)} characters of the input. Hover for code points.`
                  : 'Highlighted in the input. Hover for code points.'
                : undefined
            }
            bodyClassName="p-3"
          >
            {report.changed ? (
              <>
                <HighlightedText
                  text={analyzedText.slice(0, report.analyzedChars)}
                  ranges={report.ranges}
                  maxHeight="180px"
                  ariaLabel="Input with changed characters highlighted"
                />
                <ul className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" tabIndex={0} aria-label="Changed characters">
                  {report.changes.slice(0, 120).map((c) => (
                    <li key={c.before}>
                      <Badge className="font-mono">
                        <span className="text-fg">{c.before}</span>
                        <span className="text-fg-muted">{codePointLabel(c.before)}</span>→
                        <span className="text-fg">{c.after || '∅'}</span>
                        <span className="text-fg-muted">{c.after ? codePointLabel(c.after) : ''}</span>
                        {c.count > 1 && <span className="text-fg-muted">×{c.count}</span>}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-1 text-[13px] text-fg-muted">
                {partial
                  ? `No characters change in the first ${formatNumber(report.analyzedChars, 0)} characters.`
                  : 'No characters change with these settings.'}
              </p>
            )}
          </Panel>
        </div>
      )}
    </ToolStack>
  );
}
