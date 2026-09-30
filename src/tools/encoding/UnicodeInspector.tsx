import { Fragment, useDeferredValue, useMemo } from 'react';
import { Eraser, ScanSearch } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { cn, formatNumber, pluralize } from '@/lib/utils';
import { inspectText, stripInvisible, summarize, type CodePointInfo, type Flag } from './lib/inspect';
import { countCodePoints } from '../text/lib/common';
import { TEXT_FILE_ACCEPT } from '../text/components/shared';
import { useTask } from '../text/components/useTask';
import { t } from '@/lib/i18n';

const ID = 'unicode-inspector';
const EMPTY_SUMMARY = summarize('');
const MAX_ROWS = 2000;
const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');

function buildSample(): string {
  const c = (cp: number) => String.fromCodePoint(cp);
  // A zero-width space, an RTL override, a decomposed accent, a no-break space and an emoji family.
  return `pay${c(0x200b)}pal.com ${c(0x202e)}gnp.exe${c(0x202c)} Cafe${c(0x301)}${c(0xa0)}ok 👨${c(0x200d)}👩${c(0x200d)}👧 שלום`;
}

const FLAG_INFO: Record<Flag, { label: string; tone: 'danger' | 'warning' | 'accent' | 'neutral' }> = {
  bidi: { label: t('Bidi control'), tone: 'danger' },
  invisible: { label: t('Invisible'), tone: 'danger' },
  control: { label: t('Control'), tone: 'warning' },
  'nonstandard-space': { label: t('Unusual space'), tone: 'warning' },
  combining: { label: t('Combining'), tone: 'accent' },
  variation: { label: t('Variation selector'), tone: 'accent' },
  surrogate: { label: t('Lone surrogate'), tone: 'danger' },
  private: { label: t('Private use'), tone: 'warning' },
  unassigned: { label: t('Unassigned'), tone: 'warning' },
  replacement: { label: t('Replacement char'), tone: 'warning' },
  whitespace: { label: t('Whitespace'), tone: 'neutral' },
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
  const task = useTask('summarize', summarize, [deferred], { size: deferred.length });
  const summary = task.value ?? EMPTY_SUMMARY;
  const table = useMemo(() => inspectText(deferred, MAX_ROWS), [deferred]);

  const warnings: string[] = [];
  if (summary.invisible) warnings.push(`${pluralize(summary.invisible, t('invisible character'), t('invisible characters'))} (zero-width spaces, joiners, soft hyphens…)`);
  if (summary.bidi) warnings.push(`${pluralize(summary.bidi, t('bidirectional control'), t('bidirectional controls'))}: these can make text display in a different order than it is stored (“Trojan Source”)`);
  if (summary.control) warnings.push(`${pluralize(summary.control, t('control character'), t('control characters'))}`);
  if (summary.nonstandardSpaces) warnings.push(`${pluralize(summary.nonstandardSpaces, t('unusual space'), t('unusual spaces'))} (no-break, thin, ideographic…)`);
  if (summary.scripts.length > 1) warnings.push(`Mixed scripts: ${summary.scripts.join(', ')}`);

  function strip() {
    const cleaned = stripInvisible(input);
    const removed = countCodePoints(input) - countCodePoints(cleaned);
    setInput(cleaned);
    toast(t('Removed {count}.', { count: pluralize(removed, t('character'), t('characters')) }));
  }

  return (
    <ToolStack>
      <EditorPanel
        title={t('Text')}
        value={input}
        onChange={setInput}
        placeholder={t('Paste text that behaves strangely: odd spacing, a search that doesn’t match, an emoji that counts as 7 characters…')}
        sample={buildSample()}
        fileAccept={TEXT_FILE_ACCEPT}
        height="140px"
      />
      <ErrorMessage error={task.error} title={t('Could not inspect this text')} />
      {input && !task.value && task.pending && <Spinner label={t('Inspecting…')} />}
      {input && task.value && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-busy={task.pending || undefined}>
            <Stat label={t('Graphemes')} value={formatNumber(summary.graphemes, 0)} />
            <Stat label={t('Code points')} value={formatNumber(summary.codePoints, 0)} />
            <Stat label={t('UTF-16 units')} value={formatNumber(summary.utf16, 0)} />
            <Stat label={t('UTF-8 bytes')} value={formatNumber(summary.utf8Bytes, 0)} />
            <Stat label={t('Combining marks')} value={formatNumber(summary.combining, 0)} />
            <Stat label={t('RTL letters')} value={formatNumber(summary.rtlCharacters, 0)} />
          </div>
          {warnings.length > 0 ? (
            <Alert tone="warning" title={t('Hidden or unusual characters found')}>
              <ul className="list-disc pl-4">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {!summary.isNFC && <li>{t('Not in NFC normal form (some characters are decomposed).')}</li>}
              </ul>
              {summary.invisible + summary.bidi + summary.control > 0 && (
                <Button size="sm" icon={Eraser} onClick={strip} className="mt-2.5" disabled={task.pending}>
                  {t('Strip invisible characters')}
                </Button>
              )}
            </Alert>
          ) : (
            <Alert tone="success" title={t('No hidden characters')}>
              {summary.isNFC ? t('The text uses only visible characters and standard spaces, and is NFC-normalized.') : t('No invisible characters, but the text is not NFC-normalized.')}
            </Alert>
          )}
        </>
      )}
      <Panel
        title={t('Characters')}
        description={input ? t('Grouped by grapheme (what you see as one character). Rows with several code points are combined sequences.') : undefined}
        bodyClassName="p-0"
      >
        {!input ? (
          <EmptyState icon={ScanSearch} title={t('Nothing to inspect yet')}>
            {t('Every character’s code point, UTF-8 bytes, UTF-16 units and category appear here.')}
          </EmptyState>
        ) : (
          <div className="max-h-[560px] overflow-auto" tabIndex={0} role="region" aria-label={t('Characters table')}>
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left text-[12px] text-fg-muted">
                  <th scope="col" className="w-12 px-3 py-2 font-medium">#</th>
                  <th scope="col" className="w-14 py-2 font-medium">{t('Char')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Code point')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Category / name')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">UTF-8</th>
                  <th scope="col" className="py-2 pr-3 font-medium">UTF-16</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('Notes')}</th>
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
                              title={ci === 0 && multi ? t('Whole grapheme: {grapheme}', { grapheme: g.grapheme }) : undefined}
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
                {t('Showing the first {MAX_ROWS} characters. The summary above covers the whole text.', { MAX_ROWS: formatNumber(MAX_ROWS, 0) })}
              </p>
            )}
          </div>
        )}
      </Panel>
    </ToolStack>
  );
}
