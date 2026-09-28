import { useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { CopyButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import {
  jsonToQuery,
  normalizeQuery,
  pairsToObject,
  parsePairs,
  type ArrayFormat,
  type DuplicateMode,
  type Encoding,
  type StringifyOptions,
} from './lib/queryString';

const TOOL = 'query-string-parser';
const SAMPLE_QUERY = '?q=trail+running+shoes&page=2&sort=price_asc&brand[]=Salomon&brand[]=Hoka&filter[size][min]=42&filter[size][max]=45&filter[waterproof]=true&utm_source=newsletter&debug';
const SAMPLE_JSON = `{
  "q": "trail running shoes",
  "page": 2,
  "brand": ["Salomon", "Hoka"],
  "filter": {
    "size": { "min": 42, "max": 45 },
    "waterproof": true
  },
  "note": "café & crème 😀"
}`;

type Mode = 'parse' | 'build';

function EncodingControl({ value, onChange }: { value: Encoding; onChange: (v: Encoding) => void }) {
  return (
    <div>
      <Label>Encoding</Label>
      <Segmented
        label="Encoding"
        value={value}
        onChange={onChange}
        options={[
          { value: 'rfc3986', label: 'RFC 3986 (%20)', title: 'Strict percent-encoding; spaces become %20' },
          { value: 'form', label: 'Form (+)', title: 'application/x-www-form-urlencoded; spaces become +' },
        ]}
      />
    </div>
  );
}

function ParseMode() {
  const [input, setInput] = useToolState(TOOL, 'query', SAMPLE_QUERY);
  const [plusAsSpace, setPlusAsSpace] = useToolState(TOOL, 'plusAsSpace', true);
  const [nested, setNested] = useToolState(TOOL, 'nested', true);
  const [duplicates, setDuplicates] = useToolState<DuplicateMode>(TOOL, 'duplicates', 'array');
  const [encoding, setEncoding] = useToolState<Encoding>(TOOL, 'reEncoding', 'rfc3986');
  const [sortKeys, setSortKeys] = useToolState(TOOL, 'reSort', false);

  const pairs = useMemo(() => parsePairs(input, plusAsSpace), [input, plusAsSpace]);
  const result = useMemo(() => pairsToObject(pairs, { nested, duplicates }), [pairs, nested, duplicates]);
  const json = pairs.length ? JSON.stringify(result.value, null, 2) : '';
  const rebuilt = useMemo(
    () => normalizeQuery(pairs, { encoding, sortKeys, arrayFormat: 'brackets', readableBrackets: true }),
    [pairs, encoding, sortKeys],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pairs) m.set(p.key, (m.get(p.key) ?? 0) + 1);
    return m;
  }, [pairs]);
  const hasInput = input.trim() !== '';

  return (
    <>
      <ToolBar>
        <Switch label="+ means space" checked={plusAsSpace} onChange={setPlusAsSpace} className="h-8" />
        <Switch label="Nested brackets (a[b]=1)" checked={nested} onChange={setNested} className="h-8" />
        <div>
          <Label htmlFor="qs-dups">Repeated keys</Label>
          <Select id="qs-dups" value={duplicates} onChange={(e) => setDuplicates(e.target.value as DuplicateMode)} className="w-auto">
            <option value="array">Collect into an array</option>
            <option value="first">Keep the first value</option>
            <option value="last">Keep the last value</option>
          </Select>
        </div>
      </ToolBar>
      {result.warnings.length > 0 && (
        <Alert tone="warning" title="Some keys conflict">
          <ul className="list-disc pl-4">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      <SplitPanes>
        <EditorPanel
          title="Query string"
          value={input}
          onChange={setInput}
          placeholder="Paste a query string, ?a=1&b=2, or a full URL…"
          sample={SAMPLE_QUERY}
          fileAccept=".txt,text/plain"
          height="320px"
          footer={hasInput ? <span>{pluralize(pairs.length, 'parameter')}</span> : undefined}
        />
        <EditorPanel
          title="JSON"
          value={json}
          language="json"
          downloadName="query.json"
          downloadType="application/json"
          placeholder={hasInput ? 'No parameters found in this input.' : 'The parsed object appears here'}
          height="320px"
        />
      </SplitPanes>
      {pairs.length > 0 && (
        <Panel title={`Parameters (${pairs.length})`} bodyClassName="p-0">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead className="sticky top-0 bg-surface text-[12px] text-fg-muted">
                <tr className="border-b border-line">
                  <th className="w-10 py-2 pr-2 pl-4 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Key</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-[12.5px]">
                {pairs.slice(0, 1000).map((p, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-1.5 pr-2 pl-4 font-sans text-fg-muted tabular-nums">{i + 1}</td>
                    <td className="py-1.5 pr-3 break-all text-fg">
                      {p.key || <span className="font-sans text-fg-muted">(empty key)</span>}
                      {(counts.get(p.key) ?? 0) > 1 && (
                        <Badge tone="warning" className="ml-1.5 align-middle font-sans">
                          ×{counts.get(p.key)}
                        </Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 break-all text-fg">
                      {p.value || <span className="font-sans text-fg-muted">{p.hasEquals ? '(empty)' : '(no value)'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pairs.length > 1000 && <p className="px-4 py-2 text-[12.5px] text-fg-muted">Showing the first 1,000 of {pairs.length.toLocaleString()} parameters.</p>}
          </div>
        </Panel>
      )}
      {pairs.length > 0 && (
        <Panel title="Re-encoded query string" description="The same parameters, consistently percent-encoded.">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <EncodingControl value={encoding} onChange={setEncoding} />
              <Switch label="Sort by key" checked={sortKeys} onChange={setSortKeys} className="h-8" />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-fg">{rebuilt}</code>
              <CopyButton value={rebuilt} iconOnly label="Copy query string" />
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

function BuildMode() {
  const [input, setInput] = useToolState(TOOL, 'json', SAMPLE_JSON);
  const [encoding, setEncoding] = useToolState<Encoding>(TOOL, 'encoding', 'rfc3986');
  const [arrayFormat, setArrayFormat] = useToolState<ArrayFormat>(TOOL, 'arrayFormat', 'brackets');
  const [sortKeys, setSortKeys] = useToolState(TOOL, 'sort', false);
  const [readableBrackets, setReadableBrackets] = useToolState(TOOL, 'readableBrackets', true);
  const result = useMemo(
    () => jsonToQuery(input, { encoding, arrayFormat, sortKeys, readableBrackets } satisfies StringifyOptions),
    [input, encoding, arrayFormat, sortKeys, readableBrackets],
  );
  const output = result?.ok ? result.value : '';

  return (
    <>
      <ToolBar>
        <EncodingControl value={encoding} onChange={setEncoding} />
        <div>
          <Label htmlFor="qs-arrays">Arrays</Label>
          <Select id="qs-arrays" value={arrayFormat} onChange={(e) => setArrayFormat(e.target.value as ArrayFormat)} className="w-auto">
            <option value="brackets">tags[]=a&amp;tags[]=b</option>
            <option value="indices">tags[0]=a&amp;tags[1]=b</option>
            <option value="repeat">tags=a&amp;tags=b</option>
            <option value="comma">tags=a,b</option>
          </Select>
        </div>
        <Switch label="Sort keys" checked={sortKeys} onChange={setSortKeys} className="h-8" />
        <Switch label="Readable [ ]" checked={readableBrackets} onChange={setReadableBrackets} className="h-8" />
      </ToolBar>
      <ErrorMessage error={result && !result.ok ? result.error : null} title="Cannot build a query string" />
      <SplitPanes>
        <EditorPanel
          title="JSON"
          value={input}
          onChange={setInput}
          language="json"
          placeholder='{"page": 2, "tags": ["a", "b"]}'
          sample={SAMPLE_JSON}
          fileAccept=".json,application/json,text/plain"
          invalid={result?.ok === false}
          height="360px"
        />
        <EditorPanel
          title="Query string"
          value={output}
          placeholder="The query string appears here"
          height="360px"
          footer={
            result?.ok ? (
              <>
                <span>{pluralize(result.count, 'parameter')}</span>
                <span>{pluralize(output.length, 'character')}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </>
  );
}

export default function QueryStringParser() {
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'parse');
  return (
    <ToolStack>
      <div>
        <Segmented
          label="Direction"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'parse', label: 'Query → JSON' },
            { value: 'build', label: 'JSON → Query' },
          ]}
        />
      </div>
      {mode === 'parse' ? <ParseMode /> : <BuildMode />}
    </ToolStack>
  );
}
