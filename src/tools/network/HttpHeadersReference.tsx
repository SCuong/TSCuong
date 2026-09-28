import { useMemo, useState } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton } from '@/components/ui/Actions';
import { HTTP_HEADERS, filterHeaders, type HeaderCategory, type HeaderFilter, type HeaderStatus } from './lib/httpHeaders';
import { NoMatches, RefList, RefRow, SearchBox } from './ref/ReferenceUI';

const CATEGORIES = [...new Set(HTTP_HEADERS.map((h) => h.category))].sort() as HeaderCategory[];

const STATUS_TONE: Record<HeaderStatus, 'neutral' | 'warning' | 'accent' | 'danger'> = {
  standard: 'neutral',
  'de facto': 'accent',
  experimental: 'warning',
  deprecated: 'danger',
};

const DIRECTION_LABEL = { request: 'Request', response: 'Response', both: 'Request & response' } as const;

export default function HttpHeadersReference() {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<HeaderFilter['direction']>('all');
  const [category, setCategory] = useState<HeaderFilter['category']>('all');
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const results = useMemo(() => filterHeaders(HTTP_HEADERS, { query, direction, category }), [query, direction, category]);

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search headers, e.g. cache, cors, cookie, Strict-Transport-Security"
          label="Search HTTP headers"
          count={results.length}
          total={HTTP_HEADERS.length}
        />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="max-w-full">
            <Label>Direction</Label>
            <Segmented
              label="Direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'all', label: 'All' },
                { value: 'request', label: 'Request' },
                { value: 'response', label: 'Response' },
              ]}
            />
          </div>
          <div className="min-w-48">
            <Label htmlFor="header-category">Category</Label>
            <Select id="header-category" value={category} onChange={(e) => setCategory(e.target.value as HeaderFilter['category'])}>
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>

      <Panel bodyClassName="p-0">
        {results.length === 0 ? (
          <NoMatches
            onClear={() => {
              setQuery('');
              setDirection('all');
              setCategory('all');
            }}
          />
        ) : (
          <RefList>
            {results.map((h) => (
              <RefRow
                key={h.name}
                expanded={open.has(h.name)}
                onToggle={() => toggle(h.name)}
                summary={
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="font-mono text-[14px] font-semibold break-all text-fg">{h.name}</span>
                    <Badge>{DIRECTION_LABEL[h.direction]}</Badge>
                    <Badge tone="neutral">{h.category}</Badge>
                    {h.status !== 'standard' && <Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>}
                    {!open.has(h.name) && <span className="line-clamp-2 basis-full text-[13px] text-fg-muted">{h.description}</span>}
                  </div>
                }
              >
                <p className="text-fg">{h.description}</p>
                <p className="mt-3 mb-1.5 text-[12px] font-medium tracking-wide text-fg-muted uppercase">
                  {h.examples.length === 1 ? 'Example' : 'Examples'}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {h.examples.map((ex) => {
                    const line = `${h.name}: ${ex}`;
                    return (
                      <li key={ex} className="flex items-start gap-2">
                        <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[12.5px] break-all text-fg">
                          {line}
                        </code>
                        <CopyButton value={line} iconOnly label="Copy header line" />
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-[12.5px] text-fg-muted">Specification: {h.spec}</p>
              </RefRow>
            ))}
          </RefList>
        )}
      </Panel>
    </ToolStack>
  );
}
