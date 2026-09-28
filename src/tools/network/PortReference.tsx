import { useMemo, useState } from 'react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { Select, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { PORTS, RANGE_INFO, filterPorts, parsePortQuery, portRange, type PortCategory, type PortQuery } from './lib/ports';
import { NoMatches, SearchBox } from './ref/ReferenceUI';

const CATEGORIES = [...new Set(PORTS.map((p) => p.category))].sort() as PortCategory[];

export default function PortReference() {
  const [text, setText] = useState('');
  const [protocol, setProtocol] = useState<PortQuery['protocol']>('all');
  const [category, setCategory] = useState<PortQuery['category']>('all');

  const results = useMemo(() => filterPorts(PORTS, { text, protocol, category }), [text, protocol, category]);
  const parsed = parsePortQuery(text);

  const reset = () => {
    setText('');
    setProtocol('all');
    setCategory('all');
  };

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <SearchBox
          value={text}
          onChange={setText}
          placeholder="Port number, range (8000-8100) or service (postgres, ssh, vpn)"
          label="Search ports"
          count={results.length}
          total={PORTS.length}
        />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <Label>Protocol</Label>
            <Segmented
              label="Protocol"
              value={protocol}
              onChange={setProtocol}
              options={[
                { value: 'all', label: 'All' },
                { value: 'TCP', label: 'TCP' },
                { value: 'UDP', label: 'UDP' },
              ]}
            />
          </div>
          <div className="min-w-48">
            <Label htmlFor="port-category">Category</Label>
            <Select id="port-category" value={category} onChange={(e) => setCategory(e.target.value as PortQuery['category'])}>
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

      {parsed.kind === 'invalid' && <Alert tone="warning">{parsed.message}</Alert>}
      {parsed.kind === 'port' && (
        <Alert tone="info" title={`Port ${parsed.port} is in the ${portRange(parsed.port).toLowerCase()} range`}>
          {RANGE_INFO[portRange(parsed.port)]}
          {results.length === 0 && ' It is not in this curated list of common ports.'}
        </Alert>
      )}

      <Panel bodyClassName="p-0">
        {results.length === 0 ? (
          <NoMatches onClear={reset} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-fg-muted">
                <tr className="border-b border-line">
                  <th className="w-16 py-2 pr-2 pl-4 font-medium sm:w-20">Port</th>
                  <th className="px-4 py-2 font-medium">Service</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {results.map((p) => (
                  <tr key={`${p.port}-${p.protocol}-${p.service}`} className="align-top hover:bg-surface-hover">
                    <td className="py-2.5 pr-2 pl-4 font-mono text-[14px] font-semibold text-fg tabular-nums">{p.port}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-fg">{p.service}</span>
                        <Badge>{p.protocol}</Badge>
                        {p.unofficial && <Badge tone="warning">Unofficial</Badge>}
                      </div>
                      <p className="mt-0.5 text-fg-secondary">{p.description}</p>
                      {p.note && <p className="mt-0.5 text-[12.5px] text-warning">{p.note}</p>}
                    </td>
                    <td className="hidden px-4 py-2.5 text-fg-secondary md:table-cell">{p.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-[12.5px] text-fg-muted">
        “Unofficial” marks ports that are used by convention or by a single product rather than assigned by IANA for that
        service. {Object.values(RANGE_INFO).join(' ')}
      </p>
    </ToolStack>
  );
}
