import { useEffect, useRef, useState } from 'react';
import { FileLock, FileText, Lock, LockOpen, Upload } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Field, Label } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { KeyValueList, Panel } from '@/components/ui/Panel';
import { EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { DownloadButton } from '@/components/ui/Actions';
import { FileDrop } from '@/components/ui/FileDrop';
import { useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes, formatDuration, formatNumber } from '@/lib/utils';
import {
  DEFAULT_ITERATIONS,
  MAX_FILE_BYTES,
  decryptBytes,
  decryptText,
  encryptFile,
  encryptText,
  encryptedFileName,
  envelopeIterations,
  looksLikeTextEnvelope,
  type Plain,
} from './lib/aes';
import { FileChip, SecretInput, useElapsed } from './shared-a/ui';

const TOOL = 'aes-encrypt';
type Mode = 'encrypt' | 'decrypt';
type Source = 'text' | 'file';

type Outcome =
  | { kind: 'encrypted-text'; text: string; ms: number }
  | { kind: 'decrypted-text'; text: string; ms: number }
  | { kind: 'encrypted-file'; blob: Blob; name: string; ms: number; original: number }
  | { kind: 'decrypted-file'; plain: Extract<Plain, { kind: 'file' }>; blob: Blob; ms: number };

export default function AesEncrypt() {
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'encrypt');
  const [source, setSource] = useToolState<Source>(TOOL, 'source', 'text');
  // Secrets and plaintext are deliberately not persisted.
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed(busy !== null);
  const jobId = useRef(0);

  // Any change to the inputs invalidates the previous result.
  useEffect(() => {
    jobId.current++;
    setOutcome(null);
    setError(null);
    setBusy(null);
  }, [mode, source, text, file, passphrase]);

  const encrypting = mode === 'encrypt';
  const confirmMismatch = encrypting && confirm.length > 0 && confirm !== passphrase;
  const hasInput = source === 'text' ? text.trim().length > 0 : file !== null;
  const tooBig = file !== null && file.size > MAX_FILE_BYTES;
  const canRun =
    hasInput && passphrase.length > 0 && !tooBig && busy === null && (!encrypting || confirm === passphrase);

  async function onRun() {
    if (!canRun) return;
    const id = ++jobId.current;
    setError(null);
    setOutcome(null);
    const start = performance.now();
    try {
      let result: Outcome;
      if (source === 'text') {
        const iterations = encrypting ? DEFAULT_ITERATIONS : envelopeIterations(text);
        setBusy(`Deriving key (${formatNumber(iterations ?? DEFAULT_ITERATIONS, 0)} PBKDF2 iterations)…`);
        if (encrypting) {
          result = { kind: 'encrypted-text', text: await encryptText(text, passphrase), ms: 0 };
        } else {
          result = { kind: 'decrypted-text', text: await decryptText(text, passphrase), ms: 0 };
        }
      } else {
        setBusy('Reading file…');
        const data = new Uint8Array(await file!.arrayBuffer());
        if (id !== jobId.current) return;
        const iterations = encrypting ? DEFAULT_ITERATIONS : envelopeIterations(data);
        setBusy(
          `Deriving key (${formatNumber(iterations ?? DEFAULT_ITERATIONS, 0)} PBKDF2 iterations) and ${encrypting ? 'encrypting' : 'decrypting'} ${formatBytes(data.length)}…`,
        );
        if (encrypting) {
          const out = await encryptFile({ name: file!.name, type: file!.type, data }, passphrase);
          result = {
            kind: 'encrypted-file',
            blob: new Blob([out], { type: 'application/octet-stream' }),
            name: encryptedFileName(file!.name),
            ms: 0,
            original: data.length,
          };
        } else {
          const plain = await decryptBytes(data, passphrase);
          if (plain.kind === 'text') {
            result = { kind: 'decrypted-text', text: plain.text, ms: 0 };
          } else {
            const bytes = new Uint8Array(plain.data.length);
            bytes.set(plain.data);
            result = {
              kind: 'decrypted-file',
              plain,
              blob: new Blob([bytes], { type: plain.type || 'application/octet-stream' }),
              ms: 0,
            };
          }
        }
      }
      if (id !== jobId.current) return;
      setOutcome({ ...result, ms: performance.now() - start });
    } catch (e) {
      if (id !== jobId.current) return;
      setError(errorMessage(e, encrypting ? 'Encryption failed.' : 'Decryption failed.'));
    } finally {
      if (id === jobId.current) setBusy(null);
    }
  }

  const textLooksWrong = !encrypting && source === 'text' && text.trim() && !looksLikeTextEnvelope(text);

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Action</Label>
          <Segmented
            label="Action"
            value={mode}
            onChange={(next) => {
              setMode(next);
              // A file picked for encryption is never the one to decrypt (and vice versa).
              setFile(null);
            }}
            options={[
              { value: 'encrypt', label: 'Encrypt', icon: Lock },
              { value: 'decrypt', label: 'Decrypt', icon: LockOpen },
            ]}
          />
        </div>
        <div>
          <Label>Input</Label>
          <Segmented
            label="Input"
            value={source}
            onChange={setSource}
            options={[
              { value: 'text', label: 'Text', icon: FileText },
              { value: 'file', label: 'File', icon: Upload },
            ]}
          />
        </div>
        <p className="pb-1.5 text-[12.5px] text-fg-muted">AES-256-GCM · PBKDF2-SHA256, {formatNumber(DEFAULT_ITERATIONS, 0)} iterations</p>
      </ToolBar>

      <SplitPanes>
        <div className="flex min-w-0 flex-col gap-4">
          {source === 'text' ? (
            <EditorPanel
              title={encrypting ? 'Plain text' : 'Encrypted text'}
              value={text}
              onChange={setText}
              placeholder={encrypting ? 'Text to encrypt…' : 'Paste text starting with lkaes1.…'}
              height="220px"
              invalid={Boolean(textLooksWrong)}
              footer={
                textLooksWrong ? (
                  <span className="text-danger">This doesn't look like LocalKit encrypted text (it starts with “lkaes1.”).</span>
                ) : undefined
              }
            />
          ) : (
            <Panel title={encrypting ? 'File to encrypt' : 'Encrypted file (.lkenc)'}>
              {file ? (
                <div className="flex flex-col gap-2">
                  <FileChip file={file} onClear={() => setFile(null)} disabled={busy !== null} />
                  {tooBig && (
                    <p role="alert" className="text-[13px] text-danger">
                      Files up to {formatBytes(MAX_FILE_BYTES)} are supported: browser AES-GCM works on the whole file in
                      memory.
                    </p>
                  )}
                </div>
              ) : (
                <FileDrop
                  compact
                  onFiles={(files) => setFile(files[0])}
                  title={encrypting ? 'Drop a file to encrypt' : 'Drop an encrypted file'}
                  hint={`Up to ${formatBytes(MAX_FILE_BYTES)}. Processed on this device, never uploaded.`}
                />
              )}
            </Panel>
          )}

          <Panel title="Passphrase">
            <div className="flex flex-col gap-3">
              <Field hint={encrypting ? 'Use a long, unique passphrase. It cannot be recovered if lost.' : undefined}>
                {({ id, describedBy }) => (
                  <SecretInput
                    id={id}
                    value={passphrase}
                    onChange={setPassphrase}
                    describedBy={describedBy}
                    placeholder="Passphrase"
                    autoComplete={encrypting ? 'new-password' : 'current-password'}
                  />
                )}
              </Field>
              {encrypting && (
                <Field error={confirmMismatch ? 'The passphrases do not match.' : null}>
                  {({ id, describedBy, invalid }) => (
                    <SecretInput
                      id={id}
                      value={confirm}
                      onChange={setConfirm}
                      describedBy={describedBy}
                      invalid={invalid}
                      placeholder="Repeat passphrase"
                      autoComplete="new-password"
                    />
                  )}
                </Field>
              )}
              <Button variant="primary" icon={encrypting ? Lock : LockOpen} onClick={onRun} disabled={!canRun} loading={busy !== null}>
                {encrypting ? 'Encrypt' : 'Decrypt'}
              </Button>
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {busy !== null ? (
            <Panel title="Working">
              <ProgressBar value={null} label={busy} />
              <p className="mt-2 text-[12.5px] text-fg-muted tabular-nums">{formatDuration(elapsed)} elapsed</p>
            </Panel>
          ) : error ? (
            <ErrorMessage error={error} title={encrypting ? 'Could not encrypt' : 'Could not decrypt'} />
          ) : outcome?.kind === 'encrypted-text' || outcome?.kind === 'decrypted-text' ? (
            <EditorPanel
              title={outcome.kind === 'encrypted-text' ? 'Encrypted text' : 'Decrypted text'}
              value={outcome.text}
              downloadName={outcome.kind === 'encrypted-text' ? 'encrypted.txt' : 'decrypted.txt'}
              height="220px"
              footer={<span>Done in {formatDuration(outcome.ms)}</span>}
            />
          ) : outcome?.kind === 'encrypted-file' ? (
            <Panel title="Encrypted file" actions={<DownloadButton data={outcome.blob} filename={outcome.name} variant="primary" />}>
              <KeyValueList
                items={[
                  { label: 'File', value: <span className="break-all">{outcome.name}</span> },
                  { label: 'Size', value: `${formatBytes(outcome.blob.size)} (original ${formatBytes(outcome.original)})` },
                  { label: 'Time', value: formatDuration(outcome.ms) },
                ]}
              />
              <p className="mt-2 text-[12.5px] text-fg-muted">
                The original file name is stored inside the encrypted data and restored when decrypting.
              </p>
            </Panel>
          ) : outcome?.kind === 'decrypted-file' ? (
            <Panel
              title="Decrypted file"
              actions={<DownloadButton data={outcome.blob} filename={outcome.plain.name} variant="primary" />}
            >
              <KeyValueList
                items={[
                  { label: 'Original name', value: <span className="break-all">{outcome.plain.name}</span> },
                  { label: 'Size', value: formatBytes(outcome.blob.size) },
                  { label: 'Type', value: outcome.plain.type || 'unknown' },
                  { label: 'Time', value: formatDuration(outcome.ms) },
                ]}
              />
            </Panel>
          ) : (
            <Panel>
              <EmptyState icon={encrypting ? Lock : FileLock} title={encrypting ? 'Nothing encrypted yet' : 'Nothing decrypted yet'}>
                {encrypting
                  ? 'Add text or a file, enter the passphrase twice and press Encrypt.'
                  : 'Paste encrypted text or drop a .lkenc file, enter the passphrase and press Decrypt.'}
              </EmptyState>
            </Panel>
          )}

          <Alert tone="info" title="What this protects">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Confidentiality and integrity: without the passphrase the content can't be read, and any change is
                detected. The file name is encrypted too.
              </li>
              <li>
                It does <strong>not</strong> hide the approximate size, protect a weak passphrase from guessing, or
                protect data on an already compromised device. Lose the passphrase and the data is gone.
              </li>
            </ul>
          </Alert>
        </div>
      </SplitPanes>
    </ToolStack>
  );
}
