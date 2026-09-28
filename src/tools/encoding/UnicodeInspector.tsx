import { Fragment, useDeferredValue, useMemo } from 'react';
import { Eraser, ScanSearch } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import { inspectText, stripInvisible, summarize, type CodePointInfo, type Flag } from './lib/inspect';
import { TEXT_FILE_ACCEPT } from '../text/components/shared';

const ID = 'unicode-inspector';
const MAX_ROWS = 2000;
const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');

function buildSample(): string {
  const c = (cp: number) => String.fromCodePoint(cp);
  // A zero-width space, an RTL override, a decomposed accent, a no-break space and an emoji family.
  return `pay${c(0x200b)}pal.com ${c(0x202e)}gnp.exe${c(0x202c)} Cafe${c(0x301)}${c(0xa0)}ok 👨${c(0x200d)}👩${c(0x200d)}👧 שלום`;
}

const FLAG_INFO: Record<Flag, { label: string; tone: 'danger' | 'warning' | 'accent' | 'neutral' }> = {
  bidi: { label: 'Bidi control', tone: 'danger' },
  invisible: { label: 'Invisible', tone: 'danger' },
  control: { label: 'Control', tone: 'warning' },
  'nonstandard-space': { label: 'Unusual space', tone: 'warning' },
  combining: { label: 'Combining', tone: 'accent' },
  variation: { label: 'Variation selector', tone: 'accent' },
  surrogate: { label: 'Lone surrogate', tone: 'danger' },
  private: { label: 'Private use', tone: 'warning' },
  unassigned: { label: 'Unassigned', tone: 'warning' },
  replacement: { label: 'Replacement char', tone: 'warning' },
  whitespace: { label: 'Whitespace', tone: 'neutral' },
};

function glyph(cp: CodePointInfo): string {
  if (cp.flags.includes('combining')) return `◌${cp.char}`;
  if (cp.codePoint === 0x20) return '␠';
  if (cp.codePoint === 0x0a) return '↵';
  if (cp.codePoint === 0x0d) return '␍';
  if (cp.codePoint === 0x09) return '⇥';
  if (cp.codePoint < 0x20) return String.fromCodePoint(0x2400 + cp.codePoint);
  if (cp.flags.some((f) => f === 'invisible' || f === 'bidi' || f === 'nonstandard-space' || f === 'surrogate' || f === 'variation')) return '⬚';
  return cp.char;
}

export default function UnicodeInspector() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const deferred = useDeferredValue(input);
  const summary = useMemo(() => summarize(deferred), [deferred]);
  const table = useMemo(() => inspectText(deferred, MAX_ROWS), [deferred]);

  const warnings: string[] = [];
  if (summary.invisible) warnings.push(`${pluralize(summary.invisible, 'invisible character')} (zero-width spaces, joiners, soft hyphens…)`);
  if (summary.bidi) warnings.push(`${pluralize(summary.bidi, 'bidirectional control')}: these can make text display in a different order than it is stored (“Trojan Source”)`);
  if (summary.control) warnings.push(`${pluralize(summary.control, 'control character')}`);
  if (summary.nonstandardSpaces) warnings.push(`${pluralize(summary.nonstandardSpaces, 'unusual space')} (no-break, thin, ideographic…)`);
  if (summary.scripts.length > 1) warnings.push(`Mixed scripts: ${summary.scripts.join(', ')}`);

  function strip() {
    const cleaned = stripInvisible(input);
    const removed = Array.from(input).length - Array.from(cleaned).length;
    setInput(cleaned);
    toast(`Removed ${pluralize(removed, 'character')}.`);
  }

  return (
    <ToolStack>
      <EditorPanel
        title="Text"
        value={input}
        onChange={setInput}
        placeholder="Paste text that behaves strangely: odd spacing, a search that doesn’t match, an emoji that counts as 7 characters…"
        sample={buildSample()}
        fileAccept={TEXT_FILE_ACCEPT}
        height="140px"
      />
      {input && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Graphemes" value={formatNumber(summary.graphemes, 0)} />
            <Stat label="Code points" value={formatNumber(summary.codePoints, 0)} />
            <Stat label="UTF-16 units" value={formatNumber(summary.utf16, 0)} />
            <Stat label="UTF-8 bytes" value={formatNumber(summary.utf8Bytes, 0)} />
            <Stat label="Combining marks" value={formatNumber(summary.combining, 0)} />
            <Stat label="RTL letters" value={formatNumber(summary.rtlCharacters, 0)} />
          </div>
          {warnings.length > 0 ? (
            <Alert tone="warning" title="Hidden or unusual characters found">
              <ul className="list-disc pl-4">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {!summary.isNFC && <li>Not in NFC normal form (some characters are decomposed).</li>}
              </ul>
              {summary.invisible + summary.bidi + summary.control > 0 && (
                <Button size="sm" icon={Eraser} onClick={strip} className="mt-2.5">
                  Strip invisible characters
                </Button>
              )}
            </Alert>
          ) : (
            <Alert tone="success" title="No hidden characters">
              {summary.isNFC ? 'The text uses only visible characters and standard spaces, and is NFC-normalized.' : 'No invisible characters, but the text is not NFC-normalized.'}
            </Alert>
          )}
        </>
      )}
      <Panel
        title="Characters"
        description={input ? 'Grouped by grapheme (what you see as one character). Rows with several code points are combined sequences.' : undefined}
        bodyClassName="p-0"
      >
        {!input ? (
          <EmptyState icon={ScanSearch} title="Nothing to inspect yet">
            Every character’s code point, UTF-8 bytes, UTF-16 units and category appear here.
          </EmptyState>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left text-[12px] text-fg-muted">
                  <th scope="col" className="w-12 px-3 py-2 font-medium">#</th>
                  <th scope="col" className="w-14 py-2 font-medium">Char</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Code point</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Category / name</th>
                  <th scope="col" className="py-2 pr-3 font-medium">UTF-8</th>
                  <th scope="col" className="py-2 pr-3 font-medium">UTF-16</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {table.graphemes.map((g, gi) => (
                  <Fragment key={g.index}>
                    {g.codePoints.map((cp, ci) => {
                      const multi = g.codePoints.length > 1;
                      return (
                        <tr
                          key={`${g.index}-${ci}`}
                          className={cn(
                            'align-top',
                            ci === g.codePoints.length - 1 ? 'border-b border-line' : '',
                            multi && 'bg-surface-sunken',
                          )}
                        >
                          <td className="px-3 py-1.5 text-fg-muted tabular-nums">{ci === 0 ? gi + 1 : ''}</td>
                          <td className="py-1.5">
                            <span
                              className={cn(
                                'inline-flex min-w-8 items-center justify-center rounded-md border border-line bg-surface-raised px-1 font-mono text-[15px] leading-7',
                                cp.flags.some((f) => FLAG_INFO[f].tone === 'danger') && 'border-danger/50 text-danger',
                              )}
                              title={ci === 0 && multi ? `Whole grapheme: ${g.grapheme}` : undefined}
                            >
                              {glyph(cp)}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{cp.label}</td>
                          <td className="py-1.5 pr-3">
                            <span className="text-fg">{cp.name ?? cp.category.name}</span>
                            <span className="ml-1.5 font-mono text-[12px] text-fg-muted">
                              {cp.category.code}
                              {cp.script !== 'Common' && cp.script !== 'Inherited' && cp.script !== 'Other' ? ` · ${cp.script}` : ''}
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-[12px] whitespace-nowrap text-fg-secondary">{cp.utf8.map((b) => hex(b)).join(' ')}</td>
                          <td className="py-1.5 pr-3 font-mono text-[12px] whitespace-nowrap text-fg-secondary">{cp.utf16.map((u) => hex(u, 4)).join(' ')}</td>
                          <td className="py-1.5 pr-3">
                            <div className="flex flex-wrap gap-1">
                              {cp.flags
                                .filter((f) => f !== 'whitespace')
                                .map((f) => (
                                  <Badge key={f} tone={FLAG_INFO[f].tone}>
                                    {FLAG_INFO[f].label}
                                  </Badge>
                                ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {table.truncated && (
              <p className="border-t border-line px-3 py-2 text-[12.5px] text-fg-muted">
                Showing the first {formatNumber(MAX_ROWS, 0)} characters. The summary above covers the whole text.
              </p>
            )}
          </div>
        )}
      </Panel>
    </ToolStack>
  );
}
