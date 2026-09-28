import { useMemo, type ReactNode } from 'react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Stat } from '@/components/ui/Panel';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { CopyButton } from '@/components/ui/Actions';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  baseName,
  bitLength,
  formatInteger,
  fromTwosComplement,
  parseInteger,
  toTwosComplement,
  type Grouping,
  type Result,
} from './lib/base';

const TOOL = 'base-converter';

type FieldId = 'dec' | 'hex' | 'bin' | 'oct' | 'custom' | 'tcBin' | 'tcHex';
type WidthOpt = '8' | '16' | '32' | '64';

interface Source {
  field: FieldId;
  text: string;
}

const MAIN_FIELDS: Array<{ id: Exclude<FieldId, 'custom' | 'tcBin' | 'tcHex'>; label: string; base: number; prefix: string }> = [
  { id: 'dec', label: 'Decimal', base: 10, prefix: '' },
  { id: 'hex', label: 'Hexadecimal', base: 16, prefix: '0x' },
  { id: 'bin', label: 'Binary', base: 2, prefix: '0b' },
  { id: 'oct', label: 'Octal', base: 8, prefix: '0o' },
];

const CUSTOM_BASES = Array.from({ length: 35 }, (_, i) => i + 2);

export default function BaseConverter() {
  const [source, setSource] = useToolState<Source>(TOOL, 'source', { field: 'dec', text: '255' });
  const [customBase, setCustomBase] = useToolState(TOOL, 'customBase', 36);
  const [grouping, setGrouping] = useToolState<Grouping>(TOOL, 'grouping', 'nibble');
  const [upper, setUpper] = useToolState(TOOL, 'upper', true);
  const [widthOpt, setWidthOpt] = useToolState<WidthOpt>(TOOL, 'width', '8');
  const [signed, setSigned] = useToolState(TOOL, 'signed', false);
  const width = Number(widthOpt);

  const parsed = useMemo((): Result<bigint> | null => {
    if (!source.text.trim()) return null;
    if (source.field === 'tcBin' || source.field === 'tcHex') {
      const pattern = parseInteger(source.text, source.field === 'tcBin' ? 2 : 16);
      if (!pattern.ok) return pattern;
      return fromTwosComplement(pattern.value, width, signed);
    }
    const base = source.field === 'custom' ? customBase : MAIN_FIELDS.find((f) => f.id === source.field)!.base;
    return parseInteger(source.text, base);
  }, [source, customBase, width, signed]);

  const value = parsed?.ok ? parsed.value : null;
  const error = parsed && !parsed.ok ? parsed.error : null;

  const tc = useMemo(() => (value === null ? null : toTwosComplement(value, width, signed)), [value, width, signed]);
  const pattern = tc?.ok ? tc.value : null;

  const display = (field: FieldId, base: number, opts: { minDigits?: number } = {}): string => {
    if (source.field === field) return source.text;
    if (field === 'tcBin' || field === 'tcHex') {
      if (pattern === null) return '';
      return formatInteger(pattern, base, { grouping, uppercase: upper, minDigits: opts.minDigits });
    }
    if (value === null) return '';
    return formatInteger(value, base, { grouping, uppercase: upper });
  };

  const edit = (field: FieldId) => (text: string) => setSource({ field, text });

  const bits = value === null ? 0 : bitLength(value);
  const otherInterpretation = pattern === null ? null : signed ? pattern : BigInt.asIntN(width, pattern);

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Digit grouping</Label>
          <Segmented
            label="Digit grouping"
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: 'none', label: 'None' },
              { value: 'nibble', label: 'Nibbles', title: 'Binary in 4s, hex in 4s, decimal in thousands' },
              { value: 'byte', label: 'Bytes', title: 'Binary in 8s, hex in 2s, decimal in thousands' },
            ]}
          />
        </div>
        <Switch label="Uppercase hex" checked={upper} onChange={setUpper} className="h-8" />
      </ToolBar>

      <Panel
        title="Convert"
        description="Type in any field; the others update. Prefixes 0x, 0b and 0o, underscores, spaces and negative numbers are accepted."
        bodyClassName="flex flex-col gap-3"
      >
        {MAIN_FIELDS.map((f) => (
          <NumberField
            key={f.id}
            label={f.label}
            badge={`base ${f.base}`}
            value={display(f.id, f.base)}
            onChange={edit(f.id)}
            error={source.field === f.id ? error : null}
            copyValue={value === null ? '' : formatInteger(value, f.base, { uppercase: upper })}
            placeholder={f.id === 'dec' ? 'e.g. 255 or -42' : f.id === 'hex' ? 'e.g. FF or 0xFF' : f.id === 'bin' ? 'e.g. 1111 1111' : 'e.g. 377'}
          />
        ))}
        <NumberField
          label={
            <span className="inline-flex items-center gap-2">
              Base
              <Select
                aria-label="Custom base"
                value={customBase}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  // Keep the value when switching base while typing in this field.
                  if (source.field === 'custom' && value !== null) setSource({ field: 'dec', text: value.toString() });
                  setCustomBase(next);
                }}
                className="h-7 w-auto py-0 pr-7 pl-2 text-[13px]"
              >
                {CUSTOM_BASES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </span>
          }
          ariaLabel={`Base ${customBase}`}
          badge={[2, 8, 10, 16].includes(customBase) ? baseName(customBase) : undefined}
          value={display('custom', customBase)}
          onChange={edit('custom')}
          error={source.field === 'custom' ? error : null}
          copyValue={value === null ? '' : formatInteger(value, customBase, { uppercase: upper })}
          placeholder={`Digits 0–${customBase <= 10 ? customBase - 1 : `9, a–${'0123456789abcdefghijklmnopqrstuvwxyz'[customBase - 1]}`}`}
        />
      </Panel>

      {value !== null && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Sign" value={value < 0n ? 'Negative' : value === 0n ? 'Zero' : 'Positive'} />
          <Stat label="Bits (magnitude)" value={bits.toLocaleString('en-US')} />
          <Stat label="Bytes needed" value={Math.ceil(Math.max(bits, 1) / 8).toLocaleString('en-US')} />
          <Stat label="Decimal digits" value={(value < 0n ? -value : value).toString().length.toLocaleString('en-US')} />
        </div>
      )}

      <Panel
        title="Two's complement"
        description="The fixed-width bit pattern a computer stores. Edit the pattern to decode it."
        actions={
          <>
            <Segmented
              label="Bit width"
              size="sm"
              value={widthOpt}
              onChange={setWidthOpt}
              options={(['8', '16', '32', '64'] as WidthOpt[]).map((w) => ({ value: w, label: `${w}-bit` }))}
            />
            <Segmented
              label="Interpretation"
              size="sm"
              value={signed ? 'signed' : 'unsigned'}
              onChange={(v) => setSigned(v === 'signed')}
              options={[
                { value: 'signed', label: 'Signed' },
                { value: 'unsigned', label: 'Unsigned' },
              ]}
            />
          </>
        }
        bodyClassName="flex flex-col gap-3"
      >
        {tc && !tc.ok && source.field !== 'tcBin' && source.field !== 'tcHex' && <ErrorMessage error={tc.error} title="Overflow" />}
        <NumberField
          label={`Binary (${width} bits)`}
          value={display('tcBin', 2, { minDigits: width })}
          onChange={edit('tcBin')}
          error={source.field === 'tcBin' ? error : null}
          copyValue={pattern === null ? '' : formatInteger(pattern, 2, { minDigits: width })}
          placeholder={`Up to ${width} binary digits`}
        />
        <NumberField
          label={`Hex (${width / 4} digits)`}
          value={display('tcHex', 16, { minDigits: width / 4 })}
          onChange={edit('tcHex')}
          error={source.field === 'tcHex' ? error : null}
          copyValue={pattern === null ? '' : formatInteger(pattern, 16, { minDigits: width / 4, uppercase: upper })}
          placeholder={`Up to ${width / 4} hex digits`}
        />
        {pattern !== null && otherInterpretation !== null && value !== null && (
          <p className="text-[13px] text-fg-secondary">
            As {signed ? 'unsigned' : 'signed'} {width}-bit, the same bits mean{' '}
            <span className="font-mono font-semibold text-fg tabular-nums">{otherInterpretation.toString()}</span>
            {value < 0n && (
              <>
                {' '}
                · {value.toString()} is stored as 2<sup>{width}</sup> − {(-value).toString()}
              </>
            )}
          </p>
        )}
        {value === null && !error && (
          <Alert tone="info">Enter a number above to see its {width}-bit pattern.</Alert>
        )}
      </Panel>
    </ToolStack>
  );
}

function NumberField({
  label,
  ariaLabel,
  badge,
  value,
  onChange,
  error,
  copyValue,
  placeholder,
}: {
  label: ReactNode;
  ariaLabel?: string;
  badge?: string;
  value: string;
  onChange: (text: string) => void;
  error: string | null;
  copyValue: string;
  placeholder?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg-secondary">
          {label}
          {badge && <span className="text-[12px] font-normal text-fg-muted">{badge}</span>}
        </div>
        <CopyButton value={copyValue} iconOnly label={`Copy ${ariaLabel ?? (typeof label === 'string' ? label : 'value')}`} />
      </div>
      <textarea
        rows={1}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        placeholder={placeholder}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : 'Number')}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
        className={cn('lk-field min-h-[38px] resize-none font-mono text-[14px] break-all tabular-nums [field-sizing:content]')}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
