import { useMemo, useRef } from 'react';
import { FileUp, WandSparkles, X } from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import type { EditorLanguage } from '@/components/editor/languages';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { toast } from '@/components/ui/Toast';
import { cn, formatBytes } from '@/lib/utils';
import type { BodyMode, FormField, KeyValue, RawLanguage, RequestBody } from '../lib/model';
import type { Scope } from '../lib/vars';
import { KeyValueEditor } from './KeyValueEditor';

const MODES: Array<{ value: BodyMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'raw', label: 'Raw' },
  { value: 'form-data', label: 'Form data' },
  { value: 'urlencoded', label: 'URL-encoded' },
  { value: 'binary', label: 'Binary' },
];

const LANGS: Array<{ value: RawLanguage; label: string; editor: EditorLanguage }> = [
  { value: 'json', label: 'JSON', editor: 'json' },
  { value: 'text', label: 'Text', editor: 'plain' },
  { value: 'xml', label: 'XML', editor: 'xml' },
  { value: 'html', label: 'HTML', editor: 'html' },
];

/** JSON validation that tolerates {{variables}} used as values (e.g. "id": {{id}}). */
function jsonProblem(text: string): string | null {
  if (!text.trim()) return null;
  const probe = text.replace(/\{\{\s*[^{}]+?\s*\}\}/g, '0');
  try {
    JSON.parse(probe);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON';
    return message.replace(/^JSON\.parse: /, '');
  }
}

export function BodyEditor({
  body,
  onChange,
  scope,
  methodAllowsBody,
}: {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
  scope: Scope;
  methodAllowsBody: boolean;
}) {
  const binaryInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<RequestBody>) => onChange({ ...body, ...patch });
  const lang = LANGS.find((l) => l.value === body.rawLanguage) ?? LANGS[0];
  const problem = useMemo(() => (body.mode === 'raw' && body.rawLanguage === 'json' ? jsonProblem(body.raw) : null), [body.mode, body.rawLanguage, body.raw]);

  function formatJson() {
    try {
      set({ raw: JSON.stringify(JSON.parse(body.raw), null, 2) });
    } catch {
      toast(/\{\{/.test(body.raw) ? 'Format needs {{variables}} to be inside quotes.' : 'Fix the JSON errors first.', 'info');
    }
  }

  const canFormat = body.rawLanguage === 'json' && body.raw.trim() !== '' && !problem;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Body type" size="sm" value={body.mode} onChange={(mode) => set({ mode })} options={MODES} />
        {body.mode === 'raw' && (
          <>
            <Select
              aria-label="Raw body language"
              value={body.rawLanguage}
              onChange={(e) => set({ rawLanguage: e.target.value as RawLanguage })}
              className="h-8 w-auto py-0 text-[13px]"
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
            {body.rawLanguage === 'json' && (
              <Button
                size="sm"
                variant="ghost"
                icon={WandSparkles}
                onClick={formatJson}
                disabled={!canFormat}
                title="Pretty-print the JSON"
              >
                Format
              </Button>
            )}
          </>
        )}
      </div>

      {!methodAllowsBody && body.mode !== 'none' && (
        <Alert tone="warning">GET and HEAD requests cannot carry a body. Choose another method or set the body to None.</Alert>
      )}

      {body.mode === 'none' && <p className="py-6 text-center text-[13px] text-fg-muted">This request has no body.</p>}

      {body.mode === 'raw' && (
        <>
          <div className={cn('h-64 min-h-40 flex-1 overflow-hidden rounded-lg border', problem ? 'border-danger/60' : 'border-line')}>
            <CodeEditor
              value={body.raw}
              onChange={(raw) => set({ raw })}
              language={lang.editor}
              placeholder={body.rawLanguage === 'json' ? '{ "name": "value" }' : 'Request body'}
              ariaLabel="Raw request body"
              className="h-full"
            />
          </div>
          <p className={cn('text-[12.5px]', problem ? 'text-danger' : 'text-fg-muted')} role={problem ? 'alert' : undefined}>
            {problem
              ? `Invalid JSON: ${problem}`
              : body.raw
                ? `${formatBytes(new Blob([body.raw]).size)} · {{variables}} are replaced before sending${body.rawLanguage === 'json' ? ' · JSON is valid' : ''}`
                : 'Content-Type is set automatically unless you add one in Headers.'}
          </p>
        </>
      )}

      {body.mode === 'urlencoded' && (
        <KeyValueEditor<KeyValue>
          label="URL-encoded fields"
          rows={body.urlencoded}
          onChange={(urlencoded) => set({ urlencoded })}
          makeRow={(r) => r}
          scope={scope}
          keyLabel="Field"
        />
      )}

      {body.mode === 'form-data' && (
        <KeyValueEditor<FormField>
          label="Form fields"
          rows={body.form}
          onChange={(form) => set({ form })}
          makeRow={(r) => ({ ...r, kind: 'text' })}
          scope={scope}
          keyLabel="Field"
          extraWidth="4.5rem"
          renderExtra={(row, update) => (
            <select
              aria-label={`Type of ${row.key || 'field'}`}
              value={row.kind}
              onChange={(e) => update({ kind: e.target.value as FormField['kind'] })}
              className="h-7 w-full rounded-md border border-line bg-surface-sunken px-1 text-[12px] text-fg-secondary"
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
          )}
          renderValue={(row, update) => (row.kind === 'file' ? <FilePick row={row} update={update} /> : undefined)}
        />
      )}

      {body.mode === 'binary' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-sunken px-4 py-5">
          <Button size="sm" icon={FileUp} onClick={() => binaryInput.current?.click()}>
            {body.binary ? 'Replace file' : 'Choose file'}
          </Button>
          <input
            ref={binaryInput}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) set({ binary: file, binaryName: file.name });
              e.target.value = '';
            }}
          />
          <span className="min-w-0 text-[13px] break-all text-fg-secondary">
            {body.binary
              ? `${body.binaryName || 'file'} · ${formatBytes(body.binary.size)}${body.binary.type ? ` · ${body.binary.type}` : ''}`
              : body.binaryName
                ? `Choose "${body.binaryName}" again: files are not kept in exports or history.`
                : 'The file is sent as the raw request body.'}
          </span>
          {body.binary && (
            <Button size="sm" variant="ghost" icon={X} onClick={() => set({ binary: null })}>
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function FilePick({ row, update }: { row: FormField; update: (patch: Partial<FormField>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-1">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn(
          'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2 text-[12.5px]',
          row.file ? 'border-line bg-surface-raised text-fg' : 'border-dashed border-warning/60 text-warning',
        )}
        title={row.file ? 'Choose another file' : 'Choose a file'}
      >
        <FileUp size={13} aria-hidden className="shrink-0" />
        <span className="truncate">{row.file ? row.fileName || 'file' : row.fileName ? `Choose ${row.fileName}` : 'Choose file'}</span>
      </button>
      {row.file && <span className="hidden shrink-0 text-[12px] text-fg-muted sm:inline">{formatBytes(row.file.size)}</span>}
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) update({ file, fileName: file.name });
          e.target.value = '';
        }}
      />
    </div>
  );
}
