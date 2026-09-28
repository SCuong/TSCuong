import { useId, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Checkbox, Input, Label, NumberInput, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { formatNumber, pluralize } from '@/lib/utils';
import { CHARSETS, buildAlphabet, encodeBytes, generateStrings, type ByteEncoding, type CharsetId } from './lib/randomString';
import { cryptoBytes, entropyBits } from './lib/random';
import { OutputPanel, ToolField, clampInt } from './components';

const TOOL = 'random-string';

function strengthLabel(bits: number): { text: string; tone: string } {
  if (bits < 40) return { text: 'weak', tone: 'text-danger' };
  if (bits < 64) return { text: 'fair', tone: 'text-warning' };
  if (bits < 100) return { text: 'strong', tone: 'text-success' };
  return { text: 'very strong', tone: 'text-success' };
}

function StringsSection() {
  const [charset, setCharset] = useToolState<CharsetId>(TOOL, 'charset', 'alphanumeric');
  const [custom, setCustom] = useToolState(TOOL, 'custom', '');
  const [length, setLength] = useToolState<number | ''>(TOOL, 'length', 32);
  const [count, setCount] = useToolState<number | ''>(TOOL, 'count', 5);
  const [noLookalikes, setNoLookalikes] = useToolState(TOOL, 'noLookalikes', false);
  const [nonce, setNonce] = useState(0);
  const ids = { charset: useId(), custom: useId(), length: useId(), count: useId() };

  const alphabet = useMemo(() => buildAlphabet(charset, custom, noLookalikes), [charset, custom, noLookalikes]);
  const len = clampInt(length, 1, 1024, 1);
  const n = clampInt(count, 1, 10_000, 1);
  const text = useMemo(() => {
    void nonce;
    return alphabet.ok ? generateStrings(alphabet.alphabet, len, n).join('\n') : '';
  }, [alphabet, len, n, nonce]);
  const bits = alphabet.ok ? entropyBits(alphabet.alphabet.length, len) : 0;
  const strength = strengthLabel(bits);

  return (
    <>
      <ToolBar>
        <ToolField label="Characters" htmlFor={ids.charset} className="w-full sm:w-56">
          <Select id={ids.charset} value={charset} onChange={(e) => setCharset(e.target.value as CharsetId)}>
            {CHARSETS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </ToolField>
        <ToolField label="Length" htmlFor={ids.length} className="w-24">
          <NumberInput id={ids.length} value={length} onChange={setLength} min={1} max={1024} />
        </ToolField>
        <ToolField label="How many" htmlFor={ids.count} className="w-28">
          <NumberInput id={ids.count} value={count} onChange={setCount} min={1} max={10000} />
        </ToolField>
        <Checkbox label="Exclude look-alikes (0 O o 1 l I i L |)" checked={noLookalikes} onChange={setNoLookalikes} className="pb-2" />
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} disabled={!alphabet.ok} className="sm:ml-auto">
          Generate
        </Button>
        {charset === 'custom' && (
          <ToolField label="Custom characters" htmlFor={ids.custom} className="w-full">
            <Input
              id={ids.custom}
              mono
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. ABCDEF0123456789 (duplicates are ignored)"
              aria-invalid={!alphabet.ok || undefined}
            />
          </ToolField>
        )}
      </ToolBar>
      <ErrorMessage error={alphabet.ok ? null : alphabet.error} />
      {alphabet.ok && (
        <OutputPanel
          title={pluralize(n, 'string')}
          text={text}
          filename="random-strings.txt"
          height={n === 1 ? '96px' : '320px'}
          footer={
            <>
              <span className="tabular-nums">{alphabet.alphabet.length} possible characters</span>
              <span className="tabular-nums">
                {formatNumber(bits, 1)} bits of entropy each · <span className={strength.tone}>{strength.text}</span>
              </span>
            </>
          }
        />
      )}
    </>
  );
}

const ENCODINGS: Array<{ value: ByteEncoding; label: string }> = [
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
  { value: 'array', label: 'Byte array' },
];

function BytesSection() {
  const [size, setSize] = useToolState<number | ''>(TOOL, 'bytes', 32);
  const [encoding, setEncoding] = useToolState<ByteEncoding>(TOOL, 'encoding', 'hex');
  const [nonce, setNonce] = useState(0);
  const sizeId = useId();
  const n = clampInt(size, 1, 4096, 1);
  const bytes = useMemo(() => {
    void nonce;
    return cryptoBytes(n);
  }, [n, nonce]);
  const text = useMemo(() => encodeBytes(bytes, encoding), [bytes, encoding]);

  return (
    <>
      <ToolBar>
        <ToolField label="Bytes (1–4096)" htmlFor={sizeId} className="w-32">
          <NumberInput id={sizeId} value={size} onChange={setSize} min={1} max={4096} />
        </ToolField>
        <div>
          <Label>Encoding</Label>
          <Segmented label="Encoding" value={encoding} onChange={setEncoding} options={ENCODINGS} />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {[16, 32, 64].map((b) => (
            <Button key={b} size="sm" variant={n === b ? 'subtle' : 'ghost'} onClick={() => setSize(b)}>
              {b} bytes
            </Button>
          ))}
        </div>
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} className="sm:ml-auto">
          Generate
        </Button>
      </ToolBar>
      <OutputPanel
        title={`${pluralize(n, 'random byte')} · ${ENCODINGS.find((e) => e.value === encoding)?.label}`}
        text={text}
        filename={`random-${n}-bytes-${encoding}.txt`}
        height="220px"
        footer={<span className="tabular-nums">{formatNumber(n * 8)} bits from crypto.getRandomValues</span>}
      />
    </>
  );
}

export default function RandomString() {
  const [mode, setMode] = useToolState<'strings' | 'bytes'>(TOOL, 'mode', 'strings');
  return (
    <ToolStack>
      <Segmented
        label="Mode"
        value={mode}
        onChange={setMode}
        className="self-start"
        options={[
          { value: 'strings', label: 'Random strings' },
          { value: 'bytes', label: 'Random bytes' },
        ]}
      />
      {mode === 'strings' ? <StringsSection /> : <BytesSection />}
    </ToolStack>
  );
}
