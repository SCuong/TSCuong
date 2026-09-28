import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, Signature } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Field, Input, Label } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, errorMessage } from '@/lib/utils';
import { base64ToBytes, bytesToBase64, bytesToHex, decodeInput, equalBytes, hexToBytes, type KeyEncoding } from './shared-a/bytes';
import { HMAC_ALGORITHMS, computeHmac, type HmacAlgorithm } from './lib/hmac';
import { DigestRow, SecretInput } from './shared-a/ui';

const TOOL = 'hmac-generator';
const ENCODINGS: Array<{ value: KeyEncoding; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
];

export default function HmacGenerator() {
  const [algorithm, setAlgorithm] = useToolState<HmacAlgorithm>(TOOL, 'algo', 'SHA-256');
  const [keyEncoding, setKeyEncoding] = useToolState<KeyEncoding>(TOOL, 'keyEnc', 'text');
  const [msgEncoding, setMsgEncoding] = useToolState<KeyEncoding>(TOOL, 'msgEnc', 'text');
  const [format, setFormat] = useToolState<'hex' | 'base64'>(TOOL, 'format', 'hex');
  // The key is a secret: never persisted.
  const [key, setKey] = useState('');
  const [message, setMessage] = useToolState(TOOL, 'message', '');
  const [compare, setCompare] = useState('');

  const keyBytes = useMemo(() => decodeInput(key, keyEncoding, 'The key'), [key, keyEncoding]);
  const msgBytes = useMemo(() => decodeInput(message, msgEncoding, 'The message'), [message, msgEncoding]);
  const inputError = (!keyBytes.ok && keyBytes.error) || (!msgBytes.ok && msgBytes.error) || null;
  const hasInput = key.length > 0 || message.length > 0;

  const liveRequest = useMemo(() => ({ keyBytes, msgBytes, algorithm }), [keyBytes, msgBytes, algorithm]);
  const request = useDebouncedValue(liveRequest, 80);
  const [mac, setMac] = useState<{ bytes: Uint8Array; algorithm: HmacAlgorithm } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { keyBytes: k, msgBytes: m, algorithm: a } = request;
    if (!k.ok || !m.ok) {
      setMac(null);
      return;
    }
    let stale = false;
    computeHmac(a, k.bytes, m.bytes)
      .then((bytes) => {
        if (stale) return;
        setMac({ bytes, algorithm: a });
        setError(null);
      })
      .catch((e) => !stale && setError(errorMessage(e, 'Could not compute the HMAC.')));
    return () => {
      stale = true;
    };
  }, [request]);

  const output = mac ? (format === 'hex' ? bytesToHex(mac.bytes) : bytesToBase64(mac.bytes)) : '';
  const info = HMAC_ALGORITHMS.find((a) => a.value === algorithm)!;

  const compareResult = useMemo(() => {
    const value = compare.trim();
    if (!value || !mac) return null;
    const expected = /^[0-9a-fA-F]+$/.test(value.replace(/^0x/i, '')) ? hexToBytes(value) : base64ToBytes(value);
    if (!expected) return 'invalid' as const;
    return equalBytes(expected, mac.bytes) ? ('match' as const) : ('mismatch' as const);
  }, [compare, mac]);

  return (
    <ToolStack>
      <ToolBar>
        <div className="max-w-full">
          <Label>Algorithm</Label>
          <Segmented
            label="Algorithm"
            value={algorithm}
            onChange={setAlgorithm}
            options={HMAC_ALGORITHMS.map((a) => ({ value: a.value, label: a.label.replace('HMAC-', '') }))}
          />
        </div>
        <div>
          <Label>Output</Label>
          <Segmented
            label="Output format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' },
            ]}
          />
        </div>
      </ToolBar>

      {info.weak && (
        <Alert tone="info">
          {info.label} is only for compatibility with existing systems. It has no practical forgery attack, but it is
          deprecated; prefer HMAC-SHA256 for new designs.
        </Alert>
      )}

      <SplitPanes>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Secret key"
            actions={<Segmented label="Key encoding" size="sm" value={keyEncoding} onChange={setKeyEncoding} options={ENCODINGS} />}
          >
            <Field
              hint={
                keyBytes.ok
                  ? `${keyBytes.bytes.length} byte${keyBytes.bytes.length === 1 ? '' : 's'}. The key is never saved.`
                  : undefined
              }
              error={!keyBytes.ok ? keyBytes.error : null}
            >
              {({ id, describedBy, invalid }) => (
                <SecretInput
                  id={id}
                  value={key}
                  onChange={setKey}
                  describedBy={describedBy}
                  invalid={invalid}
                  mono
                  placeholder={keyEncoding === 'text' ? 'Secret key' : keyEncoding === 'hex' ? 'e.g. 0b0b0b0b…' : 'e.g. SmVmZQ=='}
                />
              )}
            </Field>
          </Panel>
          <EditorPanel
            title="Message"
            value={message}
            onChange={setMessage}
            placeholder={msgEncoding === 'text' ? 'Message to authenticate (UTF-8)' : `Message as ${msgEncoding}`}
            sample="what do ya want for nothing?"
            height="200px"
            invalid={!msgBytes.ok}
            actions={<Segmented label="Message encoding" size="sm" value={msgEncoding} onChange={setMsgEncoding} options={ENCODINGS} />}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={info.label} bodyClassName="p-0!">
            {hasInput && mac && !inputError ? (
              <div className="divide-y divide-line">
                <DigestRow stacked label={format === 'hex' ? 'Hex' : 'Base64'} value={output} />
                <p className="px-4 py-2.5 text-[12.5px] text-fg-muted">
                  {info.bytes * 8}-bit tag · key {keyBytes.ok ? keyBytes.bytes.length : 0} bytes · message{' '}
                  {msgBytes.ok ? msgBytes.bytes.length : 0} bytes
                </p>
              </div>
            ) : (
              <EmptyState icon={Signature} title="Enter a key and a message">
                The HMAC updates as you type. Try the sample (key “Jefe”) from RFC 4231.
              </EmptyState>
            )}
          </Panel>
          <Panel title="Verify a received MAC">
            <Field label="Expected MAC (hex or Base64)">
              {({ id }) => (
                <Input
                  id={id}
                  mono
                  value={compare}
                  onChange={(e) => setCompare(e.target.value)}
                  placeholder="Paste a signature to compare"
                  spellCheck={false}
                />
              )}
            </Field>
            {compareResult && (
              <p
                role="status"
                className={cn(
                  'mt-2.5 flex items-center gap-1.5 text-[13px] font-medium',
                  compareResult === 'match' ? 'text-success' : 'text-danger',
                )}
              >
                {compareResult === 'match' ? <CircleCheck size={15} aria-hidden /> : <CircleX size={15} aria-hidden />}
                {compareResult === 'match'
                  ? 'Match: the MAC is valid for this key and message.'
                  : compareResult === 'mismatch'
                    ? 'No match: wrong key, altered message or different algorithm.'
                    : 'That is not valid hex or Base64.'}
              </p>
            )}
          </Panel>
        </div>
      </SplitPanes>
      <ErrorMessage error={inputError ?? error} />
    </ToolStack>
  );
}
