import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize } from '@/lib/utils';
import { codePointLabel } from './lib/common';
import { measure, normalizeSegments, normalizeText, type NormalForm } from './lib/normalize';
import { HighlightedText, Opt, TEXT_FILE_ACCEPT, type HighlightRange } from './components/shared';

const ID = 'unicode-normalizer';
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
  const output = useMemo(() => normalizeText(deferred, opts), [deferred, opts]);
  const before = useMemo(() => measure(deferred), [deferred]);
  const after = useMemo(() => measure(output), [output]);

  const analysis = useMemo(() => {
    const limited = deferred.slice(0, 100_000);
    const segs = normalizeSegments(limited, opts);
    const ranges: HighlightRange[] = [];
    const changes = new Map<string, { before: string; after: string; count: number }>();
    let offset = 0;
    for (const s of segs) {
      if (s.changed) {
        ranges.push({ start: offset, end: offset + s.before.length, title: `${codePointLabel(s.before)} → ${codePointLabel(s.after) || 'removed'}` });
        const entry = changes.get(s.before);
        if (entry) entry.count++;
        else changes.set(s.before, { before: s.before, after: s.after, count: 1 });
      }
      offset += s.before.length;
    }
    return { ranges, changes: Array.from(changes.values()).sort((a, b) => b.count - a.count), changed: ranges.length };
  }, [deferred, opts]);

  const rows: Array<[string, number, number]> = [
    ['Code points', before.codePoints, after.codePoints],
    ['UTF-16 units', before.utf16, after.utf16],
    ['UTF-8 bytes', before.bytes, after.bytes],
    ['Graphemes', before.graphemes, after.graphemes],
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
      <SplitPanes>
        <EditorPanel title="Input" value={input} onChange={setInput} placeholder="Paste text to normalize…" sample={SAMPLE} fileAccept={TEXT_FILE_ACCEPT} height="260px" />
        <EditorPanel title="Normalized" value={output} placeholder="Normalized text appears here" downloadName="normalized.txt" height="260px" />
      </SplitPanes>
      {input && (
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
              {output === deferred ? 'The text is already in this form.' : `${pluralize(analysis.changed, 'character')} changed.`}
            </p>
          </Panel>
          <Panel title="Changed characters" description={analysis.changed ? 'Highlighted in the input. Hover for code points.' : undefined} bodyClassName="p-3">
            {analysis.changed ? (
              <>
                <HighlightedText text={deferred.slice(0, 100_000)} ranges={analysis.ranges} maxHeight="180px" ariaLabel="Input with changed characters highlighted" />
                <ul className="mt-3 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                  {analysis.changes.slice(0, 120).map((c) => (
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
              <p className="px-1 text-[13px] text-fg-muted">No characters change with these settings.</p>
            )}
          </Panel>
        </div>
      )}
    </ToolStack>
  );
}
