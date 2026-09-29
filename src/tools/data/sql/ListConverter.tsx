import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { DirectionSwitch, NotesPanel, Option, TextStats } from '../convert/shared/ConvertUi';
import {
  buildList,
  parseList,
  type EscapeStyle,
  type ListFormat,
  type ListStats,
  type ParseSeparator,
  type QuoteStyle,
  type SortMode,
  type SplitMode,
} from './lib/listConvert';

const TOOL = 'list-converter';
type Direction = 'toList' | 'toLines';

const SAMPLE_LINES = `alice@example.com
bob@example.com
o'neil@example.com
alice@example.com

carol@example.com`;

const SAMPLE_LIST = `status IN ('new', 'processing', 'on hold', 'O''Brien review')`;

interface BuildSettings {
  format: ListFormat;
  split: SplitMode;
  unquotedNumbers: boolean;
  quote: QuoteStyle;
  escape: EscapeStyle;
  separator: string;
  prefix: string;
  suffix: string;
  perLine: number;
  column: string;
  chunk: number;
  negate: boolean;
}

interface CleanSettings {
  trim: boolean;
  removeEmpty: boolean;
  dedupe: boolean;
  ignoreCase: boolean;
  sort: SortMode;
}

interface ParseSettings {
  separator: ParseSeparator;
  unquote: boolean;
}

function statsText(stats: ListStats): string[] {
  const parts = [pluralize(stats.items, 'item')];
  if (stats.duplicates) parts.push(`${pluralize(stats.duplicates, 'duplicate')} removed`);
  if (stats.empty) parts.push(`${pluralize(stats.empty, 'empty line')} skipped`);
  return parts;
}

export default function ListConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(TOOL, 'direction', 'toList');
  const [b, setB] = useToolState<BuildSettings>(TOOL, 'build', {
    format: 'sql',
    split: 'lines',
    unquotedNumbers: true,
    quote: 'single',
    escape: 'double',
    separator: ', ',
    prefix: '',
    suffix: '',
    perLine: 0,
    column: '',
    chunk: 0,
    negate: false,
  });
  const [c, setC] = useToolState<CleanSettings>(TOOL, 'clean', { trim: true, removeEmpty: true, dedupe: false, ignoreCase: false, sort: 'none' });
  const [p, setP] = useToolState<ParseSettings>(TOOL, 'parse', { separator: 'auto', unquote: true });
  const setBuild = <K extends keyof BuildSettings>(key: K, value: BuildSettings[K]) => setB((o) => ({ ...o, [key]: value }));
  const setClean = <K extends keyof CleanSettings>(key: K, value: CleanSettings[K]) => setC((o) => ({ ...o, [key]: value }));

  const toList = direction === 'toList';
  const deferred = useDeferredValue(input);
  const result = useMemo(() => {
    if (!deferred.trim()) return null;
    if (toList) return buildList(deferred, { ...b, ...c });
    const parsed = parseList(deferred, { ...p, ...c });
    return { output: parsed.output, stats: parsed.stats, notes: [] as string[] };
  }, [deferred, toList, b, c, p]);
  const output = result?.output ?? '';

  function swap() {
    setInput(output);
    setDirection(toList ? 'toLines' : 'toList');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionSwitch
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'toList', label: 'Lines → list' },
            { value: 'toLines', label: 'List → lines' },
          ]}
          onSwap={swap}
          canSwap={Boolean(output)}
        />
        {toList ? (
          <>
            <Option label="Output">
              <Segmented
                label="Output"
                value={b.format}
                onChange={(v) => setBuild('format', v)}
                options={[
                  { value: 'sql', label: 'SQL IN' },
                  { value: 'json', label: 'JSON array' },
                  { value: 'quoted', label: 'Quoted list' },
                ]}
              />
            </Option>
            <Option label="Split input on" htmlFor="lc-split" className="w-44">
              <Select id="lc-split" value={b.split} onChange={(e) => setBuild('split', e.target.value as SplitMode)} className="h-8 py-1 text-[13px]">
                <option value="lines">New lines</option>
                <option value="commas">Commas</option>
                <option value="whitespace">Spaces and new lines</option>
                <option value="any">Lines, commas, tabs, ;</option>
              </Select>
            </Option>
            <Option label="Items per line" htmlFor="lc-perline" className="w-32">
              <Select id="lc-perline" value={String(b.perLine)} onChange={(e) => setBuild('perLine', Number(e.target.value))} className="h-8 py-1 text-[13px]">
                <option value="0">All</option>
                <option value="1">1</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </Select>
            </Option>
            {b.format === 'sql' && (
              <>
                <Option label="Column" htmlFor="lc-column" className="w-36">
                  <Input
                    id="lc-column"
                    value={b.column}
                    onChange={(e) => setBuild('column', e.target.value)}
                    placeholder="optional"
                    spellCheck={false}
                    className="h-8 py-1 font-mono text-[13px]"
                  />
                </Option>
                <Option label="Max items per IN" htmlFor="lc-chunk" className="w-40">
                  <Select id="lc-chunk" value={String(b.chunk)} onChange={(e) => setBuild('chunk', Number(e.target.value))} className="h-8 py-1 text-[13px]">
                    <option value="0">No limit</option>
                    <option value="1000">1,000 (Oracle)</option>
                    <option value="500">500</option>
                    <option value="100">100</option>
                  </Select>
                </Option>
                <Switch label="NOT IN" checked={b.negate} onChange={(v) => setBuild('negate', v)} className="h-8" />
              </>
            )}
            {b.format === 'quoted' && (
              <>
                <Option label="Quote" htmlFor="lc-quote" className="w-32">
                  <Select id="lc-quote" value={b.quote} onChange={(e) => setBuild('quote', e.target.value as QuoteStyle)} className="h-8 py-1 text-[13px]">
                    <option value="single">'single'</option>
                    <option value="double">"double"</option>
                    <option value="backtick">`backtick`</option>
                    <option value="none">None</option>
                  </Select>
                </Option>
                <Option label="Escape quotes" htmlFor="lc-escape" className="w-36">
                  <Select id="lc-escape" value={b.escape} onChange={(e) => setBuild('escape', e.target.value as EscapeStyle)} className="h-8 py-1 text-[13px]">
                    <option value="double">Double them</option>
                    <option value="backslash">Backslash</option>
                    <option value="none">Leave as is</option>
                  </Select>
                </Option>
                <Option label="Separator" htmlFor="lc-sep" className="w-24">
                  <Input
                    id="lc-sep"
                    value={b.separator}
                    onChange={(e) => setBuild('separator', e.target.value)}
                    spellCheck={false}
                    title="Use \n for a new line and \t for a tab"
                    className="h-8 py-1 font-mono text-[13px]"
                  />
                </Option>
                <Option label="Before" htmlFor="lc-prefix" className="w-20">
                  <Input id="lc-prefix" value={b.prefix} onChange={(e) => setBuild('prefix', e.target.value)} spellCheck={false} className="h-8 py-1 font-mono text-[13px]" />
                </Option>
                <Option label="After" htmlFor="lc-suffix" className="w-20">
                  <Input id="lc-suffix" value={b.suffix} onChange={(e) => setBuild('suffix', e.target.value)} spellCheck={false} className="h-8 py-1 font-mono text-[13px]" />
                </Option>
              </>
            )}
            <Switch label="Numbers without quotes" checked={b.unquotedNumbers} onChange={(v) => setBuild('unquotedNumbers', v)} className="h-8" />
          </>
        ) : (
          <>
            <Option label="Separator" htmlFor="lc-psep" className="w-40">
              <Select id="lc-psep" value={p.separator} onChange={(e) => setP((o) => ({ ...o, separator: e.target.value as ParseSeparator }))} className="h-8 py-1 text-[13px]">
                <option value="auto">Auto-detect</option>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={'\t'}>Tab</option>
                <option value="|">Pipe</option>
                <option value="whitespace">Spaces</option>
              </Select>
            </Option>
            <Switch label="Remove quotes" checked={p.unquote} onChange={(v) => setP((o) => ({ ...o, unquote: v }))} className="h-8" />
          </>
        )}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-3">
          <Switch label="Trim spaces" checked={c.trim} onChange={(v) => setClean('trim', v)} />
          <Switch label="Skip empty items" checked={c.removeEmpty} onChange={(v) => setClean('removeEmpty', v)} />
          <Switch label="Remove duplicates" checked={c.dedupe} onChange={(v) => setClean('dedupe', v)} />
          {c.dedupe && <Switch label="Ignore case" checked={c.ignoreCase} onChange={(v) => setClean('ignoreCase', v)} />}
          <div className="flex items-center gap-2">
            <label htmlFor="lc-sort" className="text-sm text-fg">
              Sort
            </label>
            <Select id="lc-sort" value={c.sort} onChange={(e) => setClean('sort', e.target.value as SortMode)} className="h-8 w-28 py-1 text-[13px]">
              <option value="none">Keep order</option>
              <option value="asc">A → Z</option>
              <option value="desc">Z → A</option>
            </Select>
          </div>
        </div>
      </ToolBar>

      <NotesPanel notes={result?.notes ?? []} title="Notes" />

      <SplitPanes>
        <EditorPanel
          title={toList ? 'Items (one per line)' : 'List'}
          value={input}
          onChange={setInput}
          placeholder={toList ? 'Paste values, one per line (e.g. a column copied from a spreadsheet)…' : "Paste a list such as 'a', 'b', 'c' or IN (1, 2, 3)…"}
          sample={toList ? SAMPLE_LINES : SAMPLE_LIST}
          fileAccept=".txt,.csv,.tsv,.log,.sql,.json,text/plain"
          height="420px"
          lineWrapping={!toList}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title={toList ? (b.format === 'sql' ? 'SQL' : b.format === 'json' ? 'JSON array' : 'Quoted list') : 'Items (one per line)'}
          value={output}
          language={toList && b.format === 'sql' ? 'sql' : toList && b.format === 'json' ? 'json' : undefined}
          downloadName={toList ? (b.format === 'sql' ? 'in-list.sql' : b.format === 'json' ? 'list.json' : 'list.txt') : 'items.txt'}
          downloadType={toList && b.format === 'json' ? 'application/json' : 'text/plain'}
          placeholder="The result appears here"
          height="420px"
          footer={
            result && result.stats.found > 0 ? (
              <>
                {statsText(result.stats).map((t) => (
                  <span key={t}>{t}</span>
                ))}
                {toList && result.stats.numeric && <span>numbers left unquoted</span>}
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
