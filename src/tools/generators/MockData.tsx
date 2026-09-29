import { useEffect, useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Dices, Plus, RotateCcw, Trash } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Input, Label, NumberInput, Select } from '@/components/ui/Field';
import { Button, IconButton } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Alert } from '@/components/ui/Alert';
import { ProgressBar } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState, nextFrame } from '@/lib/hooks';
import { cn, errorMessage, formatNumber } from '@/lib/utils';
import {
  FIELD_TYPES,
  FORMAT_META,
  MAX_ROWS,
  createRowGenerator,
  defaultOptions,
  formatRows,
  validateSchema,
  type DateFormat,
  type FieldOptions,
  type FieldType,
  type MockField,
  type OutputFormat,
  type Row,
  type Value,
} from './lib/mock';
import { OutputPanel, ToolField } from './components';

const TOOL = 'mock-data';
const PREVIEW_ROWS = 50;
const CHUNK = 1000;

function newFieldId(): string {
  return crypto.randomUUID();
}

function f(name: string, type: FieldType, options: FieldOptions = defaultOptions(type)): MockField {
  return { id: `${name}-${type}`, name, type, options };
}

const DEFAULT_SCHEMA: MockField[] = [
  f('id', 'autoIncrement'),
  f('first_name', 'firstName'),
  f('last_name', 'lastName'),
  f('email', 'email'),
  f('city', 'city'),
  f('country', 'country'),
  f('age', 'integer', { min: 18, max: 80 }),
  f('active', 'boolean', { probability: 70 }),
  f('signed_up', 'date', { from: '2022-01-01', to: '2025-12-31', dateFormat: 'date' }),
];

const GROUPS = [...new Set(FIELD_TYPES.map((t) => t.group))];

function randomSeed(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b & 31]).join('');
}

// ---------------------------------------------------------------------------
// Field editor
// ---------------------------------------------------------------------------

function NumOpt({ label, value, onChange, min, max, step, className }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number | 'any'; className?: string }) {
  const id = useId();
  return (
    <ToolField label={label} htmlFor={id} className={cn('w-24', className)}>
      <NumberInput id={id} value={value ?? ''} onChange={(v) => onChange(v === '' ? undefined : v)} min={min} max={max} step={step} />
    </ToolField>
  );
}

function FieldOptionsEditor({ field, onChange }: { field: MockField; onChange: (o: FieldOptions) => void }) {
  const o = field.options;
  const set = (patch: Partial<FieldOptions>) => onChange({ ...o, ...patch });
  const ids = { from: useId(), to: useId(), fmt: useId(), values: useId() };
  switch (field.type) {
    case 'autoIncrement':
      return (
        <>
          <NumOpt label="Start" value={o.start} onChange={(v) => set({ start: v })} step={1} />
          <NumOpt label="Step" value={o.step} onChange={(v) => set({ step: v })} step={1} />
        </>
      );
    case 'integer':
      return (
        <>
          <NumOpt label="Min" value={o.min} onChange={(v) => set({ min: v })} step={1} className="w-28" />
          <NumOpt label="Max" value={o.max} onChange={(v) => set({ max: v })} step={1} className="w-28" />
        </>
      );
    case 'float':
      return (
        <>
          <NumOpt label="Min" value={o.min} onChange={(v) => set({ min: v })} step="any" className="w-28" />
          <NumOpt label="Max" value={o.max} onChange={(v) => set({ max: v })} step="any" className="w-28" />
          <NumOpt label="Decimals" value={o.decimals} onChange={(v) => set({ decimals: v })} min={0} max={10} step={1} />
        </>
      );
    case 'boolean':
      return <NumOpt label="% true" value={o.probability} onChange={(v) => set({ probability: v })} min={0} max={100} className="w-24" />;
    case 'date':
      return (
        <>
          <ToolField label="From" htmlFor={ids.from} className="w-36">
            <Input id={ids.from} type="date" value={o.from ?? ''} onChange={(e) => set({ from: e.target.value })} />
          </ToolField>
          <ToolField label="To" htmlFor={ids.to} className="w-36">
            <Input id={ids.to} type="date" value={o.to ?? ''} onChange={(e) => set({ to: e.target.value })} />
          </ToolField>
          <ToolField label="Output as" htmlFor={ids.fmt} className="w-36">
            <Select id={ids.fmt} value={o.dateFormat ?? 'date'} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
              <option value="date">YYYY-MM-DD</option>
              <option value="datetime">ISO date-time</option>
              <option value="unix">Unix seconds</option>
              <option value="unixMs">Unix milliseconds</option>
            </Select>
          </ToolField>
        </>
      );
    case 'enum':
      return (
        <ToolField label="Values (comma separated)" htmlFor={ids.values} className="w-full min-w-48 sm:w-72">
          <Input id={ids.values} value={o.values ?? ''} onChange={(e) => set({ values: e.target.value })} placeholder="red, green, blue" />
        </ToolField>
      );
    case 'words':
      return <NumOpt label="Words" value={o.count} onChange={(v) => set({ count: v })} min={1} max={50} step={1} />;
    default:
      return null;
  }
}

function FieldRow({
  field,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  field: MockField;
  index: number;
  total: number;
  onChange: (f: MockField) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const typeId = useId();
  return (
    <li className="flex gap-2 px-3 py-3 sm:px-4">
      <div className="flex shrink-0 flex-col gap-0.5 pt-6">
        <IconButton icon={ArrowUp} label={`Move ${field.name || 'field'} up`} size="sm" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon={ArrowDown} label={`Move ${field.name || 'field'} down`} size="sm" disabled={index === total - 1} onClick={() => onMove(1)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-2">
        <ToolField label="Name" htmlFor={nameId} className="w-full sm:w-40">
          <Input id={nameId} mono value={field.name} onChange={(e) => onChange({ ...field, name: e.target.value })} aria-invalid={!field.name.trim() || undefined} />
        </ToolField>
        <ToolField label="Type" htmlFor={typeId} className="w-full sm:w-44">
          <Select
            id={typeId}
            value={field.type}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              onChange({ ...field, type, options: { ...defaultOptions(type), blank: field.options.blank } });
            }}
          >
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {FIELD_TYPES.filter((t) => t.group === g).map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </ToolField>
        <FieldOptionsEditor field={field} onChange={(options) => onChange({ ...field, options })} />
        {field.type !== 'autoIncrement' && (
          <NumOpt
            label="Blank %"
            value={field.options.blank ?? 0}
            onChange={(v) => onChange({ ...field, options: { ...field.options, blank: v } })}
            min={0}
            max={100}
            className="w-20"
          />
        )}
      </div>
      <div className="shrink-0 pt-6">
        <IconButton icon={Trash} label={`Remove ${field.name || 'field'}`} size="sm" onClick={onRemove} disabled={total === 1} />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface Generated {
  columns: string[];
  preview: Row[];
  text: string;
  count: number;
  format: OutputFormat;
}

function Cell({ v }: { v: Value }) {
  if (v === null) return <span className="text-fg-muted italic">null</span>;
  if (typeof v === 'boolean') return <span className={v ? 'text-success' : 'text-fg-muted'}>{String(v)}</span>;
  return <>{String(v)}</>;
}

export default function MockData() {
  const [schema, setSchema] = useToolState<MockField[]>(TOOL, 'schema', DEFAULT_SCHEMA);
  const [rowCount, setRowCount] = useToolState<number | ''>(TOOL, 'rows', 100);
  const [seed, setSeed] = useToolState(TOOL, 'seed', 'localkit');
  const [format, setFormat] = useToolState<OutputFormat>(TOOL, 'format', 'json');
  const [table, setTable] = useToolState(TOOL, 'table', 'mock_data');
  const [result, setResult] = useState<Generated | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const ids = { rows: useId(), seed: useId(), table: useId() };

  const errors = useMemo(() => {
    const list = validateSchema(schema);
    if (rowCount === '' || !Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_ROWS) list.push(`Rows must be a whole number from 1 to ${formatNumber(MAX_ROWS)}.`);
    return list;
  }, [schema, rowCount]);

  const requestNow = useMemo(() => ({ schema, rowCount, seed, format, table }), [schema, rowCount, seed, format, table]);
  const request = useDebouncedValue(requestNow, 250);

  useEffect(() => {
    const { schema: fields, rowCount: count, seed: s, format: fmt, table: tbl } = request;
    if (validateSchema(fields).length > 0 || count === '' || !Number.isInteger(count) || count < 1 || count > MAX_ROWS) return;
    let cancelled = false;
    (async () => {
      try {
        const gen = createRowGenerator(fields, s);
        const rows: Row[] = [];
        const showProgress = count > 2 * CHUNK;
        for (let i = 0; i < count; i++) {
          rows.push(gen.next());
          if ((i + 1) % CHUNK === 0 && i + 1 < count) {
            if (showProgress) setProgress((i + 1) / count);
            await nextFrame();
            if (cancelled) return;
          }
        }
        const columns = fields.map((x) => x.name.trim());
        if (showProgress) setProgress(1);
        await nextFrame();
        if (cancelled) return;
        const text = formatRows(fmt, columns, rows, tbl);
        if (cancelled) return;
        setResult({ columns, preview: rows.slice(0, PREVIEW_ROWS), text, count, format: fmt });
        setGenError(null);
      } catch (error) {
        if (!cancelled) setGenError(errorMessage(error, 'Could not generate the data.'));
      } finally {
        if (!cancelled) setProgress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  function update(index: number, field: MockField) {
    setSchema((s) => s.map((x, i) => (i === index ? field : x)));
  }
  function move(index: number, delta: -1 | 1) {
    setSchema((s) => {
      const next = s.slice();
      const j = index + delta;
      if (j < 0 || j >= next.length) return s;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }
  function addField() {
    setSchema((s) => {
      let n = s.length + 1;
      const names = new Set(s.map((x) => x.name.trim()));
      while (names.has(`field_${n}`)) n++;
      return [...s, { id: newFieldId(), name: `field_${n}`, type: 'words', options: defaultOptions('words') }];
    });
  }

  const stale = result !== null && (result.format !== format || errors.length > 0);

  return (
    <ToolStack>
      <Panel
        title="Fields"
        description={`${schema.length} field${schema.length === 1 ? '' : 's'} · the same seed and fields always produce the same data`}
        bodyClassName="p-0!"
        actions={
          <>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setSchema(DEFAULT_SCHEMA)}>
              Reset
            </Button>
            <Button size="sm" icon={Plus} onClick={addField}>
              Add field
            </Button>
          </>
        }
      >
        <ol className="divide-y divide-line">
          {schema.map((field, i) => (
            <FieldRow
              key={field.id}
              field={field}
              index={i}
              total={schema.length}
              onChange={(nf) => update(i, nf)}
              onMove={(d) => move(i, d)}
              onRemove={() => setSchema((s) => s.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      </Panel>

      <ToolBar>
        <ToolField label={`Rows (max ${formatNumber(MAX_ROWS)})`} htmlFor={ids.rows} className="w-36">
          <NumberInput id={ids.rows} value={rowCount} onChange={setRowCount} min={1} max={MAX_ROWS} step={1} />
        </ToolField>
        <ToolField label="Seed" htmlFor={ids.seed} className="w-full sm:w-52">
          <div className="flex gap-1.5">
            <Input id={ids.seed} mono value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="any text" />
            <IconButton icon={Dices} label="New random seed" variant="secondary" onClick={() => setSeed(randomSeed())} />
          </div>
        </ToolField>
        <div>
          <Label>Format</Label>
          <Segmented
            label="Output format"
            value={format}
            onChange={setFormat}
            options={(Object.keys(FORMAT_META) as OutputFormat[]).map((k) => ({ value: k, label: FORMAT_META[k].label }))}
          />
        </div>
        {format === 'sql' && (
          <ToolField label="Table name" htmlFor={ids.table} className="w-full sm:w-44">
            <Input id={ids.table} mono value={table} onChange={(e) => setTable(e.target.value)} placeholder="mock_data" />
          </ToolField>
        )}
      </ToolBar>

      {errors.length > 0 && (
        <Alert tone="danger" title="Fix these to generate data">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {genError && <Alert tone="danger" title="Could not generate">{genError}</Alert>}
      {progress !== null && <ProgressBar value={progress} label="Generating rows…" />}

      {result && (
        <div className={cn('flex flex-col gap-4 transition-opacity', stale && 'opacity-60')}>
          <Panel
            title="Preview"
            description={`First ${Math.min(PREVIEW_ROWS, result.count)} of ${formatNumber(result.count)} rows`}
            bodyClassName="p-0!"
          >
            <div className="max-h-[420px] overflow-auto" tabIndex={0} role="region" aria-label="Preview rows">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 z-[1] bg-surface-sunken text-fg-muted shadow-[0_1px_0_var(--lk-border)]">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c} className="px-3 py-2 font-mono font-medium whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.preview.map((row, i) => (
                    <tr key={i} className="hover:bg-surface-hover/60">
                      {result.columns.map((c) => (
                        <td key={c} className="max-w-[280px] truncate px-3 py-1.5 font-mono whitespace-nowrap text-fg" title={String(row[c] ?? 'null')}>
                          <Cell v={row[c] ?? null} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <OutputPanel
            title={`${FORMAT_META[result.format].label} output`}
            text={result.text}
            filename={`mock-data.${FORMAT_META[result.format].ext}`}
            mime={FORMAT_META[result.format].mime}
            height="360px"
            footer={<span className="tabular-nums">{formatNumber(result.count)} rows</span>}
          />
        </div>
      )}
    </ToolStack>
  );
}
