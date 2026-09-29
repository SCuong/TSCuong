import { useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Checkbox, Textarea } from '@/components/ui/Field';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { newId } from '@/lib/storage/db';
import { downloadBlob, errorMessage, pluralize } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { buildExport, parseImport, type ImportResult } from '../lib/exchange';
import { draftFromCurl, looksLikeCurl } from '../lib/curlImport';
import { findSecrets, type ApiCollection, type ApiEnvironment, type RequestDraft, type SavedRequest } from '../lib/model';

const MAX_IMPORT = 20 * 1024 * 1024;

export function ImportDialog({
  open,
  onClose,
  onImport,
  onCurl,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => Promise<void>;
  onCurl: (draft: RequestDraft, warnings: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setText('');
    setResult(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  function read(input: string) {
    setResult(null);
    setError(null);
    if (looksLikeCurl(input)) {
      const r = draftFromCurl(input);
      if (!r.ok) return setError(r.error);
      onCurl(r.draft, r.warnings);
      close();
      return;
    }
    const r = parseImport(input, newId);
    if (!r.ok) setError(r.error);
    else setResult(r.result);
  }

  async function onFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_IMPORT) return setError('That file is larger than 20 MB, which is too big for a collection export.');
    try {
      const content = await file.text();
      setText(content.length > 200_000 ? '' : content);
      read(content);
    } catch (e) {
      setError(errorMessage(e, 'Could not read the file.'));
    }
  }

  async function confirm() {
    if (!result) return;
    setBusy(true);
    try {
      await onImport(result);
      toast(`Imported ${summary(result)}.`);
      close();
    } catch (e) {
      setError(errorMessage(e, 'Could not save the imported data.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="Import"
      description="LocalKit API exports, Postman Collection v2.0/v2.1, Postman environments, or a curl command."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          {result ? (
            <Button variant="primary" onClick={confirm} loading={busy}>
              Import {summary(result)}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => read(text)} disabled={!text.trim()}>
              Read
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FileDrop onFiles={onFile} accept=".json,application/json" compact title="Drop a .json export here" hint="or click to choose a file" icon={FileUp} onReject={setError} />
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
            setError(null);
          }}
          placeholder={'…or paste JSON or a curl command, e.g.\ncurl https://api.example.com/items -H "Accept: application/json"'}
          aria-label="Paste import data"
          className="h-40 resize-y"
        />
        <ErrorMessage error={error} title="Cannot import" />
        {result && (
          <Alert tone="success" title={`Ready to import ${summary(result)}`}>
            {result.kind === 'postman-collection' ? 'Postman collection' : result.kind === 'postman-environment' ? 'Postman environment' : 'LocalKit export'}. Nothing
            existing is overwritten; imported items are added alongside.
          </Alert>
        )}
        {result && result.warnings.length > 0 && (
          <Alert tone="warning" title="Notes">
            <ul className="list-disc space-y-0.5 pl-4">
              {result.warnings.slice(0, 12).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {result.warnings.length > 12 && <li>…and {result.warnings.length - 12} more.</li>}
            </ul>
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

function summary(r: ImportResult): string {
  const parts: string[] = [];
  if (r.collections.length) parts.push(pluralize(r.collections.length, 'collection'));
  if (r.requests.length) parts.push(pluralize(r.requests.length, 'request'));
  if (r.environments.length) parts.push(pluralize(r.environments.length, 'environment'));
  return parts.join(', ') || 'nothing';
}

export function ExportDialog({
  open,
  onClose,
  collections,
  requests,
  environments,
  only,
}: {
  open: boolean;
  onClose: () => void;
  collections: ApiCollection[];
  requests: SavedRequest[];
  environments: ApiEnvironment[];
  /** Export just this collection (no environments). */
  only: ApiCollection | null;
}) {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const cols = only ? [only] : collections;
  const reqs = requests.filter((r) => cols.some((c) => c.id === r.collectionId));
  const envs = only ? [] : environments;
  const secretCount = reqs.filter((r) => findSecrets(r).length > 0).length + envs.filter((e) => e.variables.some((v) => v.secret && v.value)).length;
  const empty = cols.length === 0 && envs.length === 0;

  function download() {
    const file = buildExport(cols, reqs, envs, includeSecrets);
    const date = new Date().toISOString().slice(0, 10);
    const base = only ? only.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'collection' : 'localkit-api';
    downloadBlob(JSON.stringify(file, null, 2), `${base}-${date}.json`, 'application/json');
    setIncludeSecrets(false);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        setIncludeSecrets(false);
        onClose();
      }}
      title={only ? `Export “${only.name}”` : 'Export collections and environments'}
      description="A versioned JSON file you can import into LocalKit on another browser or computer."
      footer={
        <Button variant="primary" icon={Download} onClick={download} disabled={empty}>
          Download JSON
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-fg-secondary">
        {empty ? (
          <p>There is nothing to export yet.</p>
        ) : (
          <p>
            {[pluralize(cols.length, 'collection'), pluralize(reqs.length, 'request'), !only && pluralize(envs.length, 'environment')].filter(Boolean).join(', ')}.
            Chosen files are never included, only their names.
          </p>
        )}
        <Checkbox
          label="Include secrets"
          description="Tokens, passwords, API keys, sensitive header values and secret environment variables."
          checked={includeSecrets}
          onChange={setIncludeSecrets}
          disabled={empty}
        />
        {includeSecrets && (
          <Alert tone="warning">The file will contain your secrets in plain text. Store and share it carefully.</Alert>
        )}
        {!includeSecrets && secretCount > 0 && <p className="text-fg-muted">Secret values are left blank in the file; structure and variable names are kept.</p>}
      </div>
    </Dialog>
  );
}
