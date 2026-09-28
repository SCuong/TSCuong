import { useMemo, useState } from 'react';
import { Library, Search } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Badge, Kbd } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { Alert } from '@/components/ui/Alert';
import { cn, formatNumber, modKey, pluralize } from '@/lib/utils';
import { getSnippetLanguage } from '../lib/languages';
import { SNIPPET_TEMPLATES, type SnippetTemplate } from '../lib/templates';
import { planImport, type ConflictStrategy, type ParsedImport } from '../lib/io';
import type { Snippet } from '../lib/model';
import { CodePreview } from './HighlightedCode';

export function TemplatesDialog({
  open,
  onClose,
  onUse,
  onAddAll,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: SnippetTemplate) => void;
  onAddAll: () => void;
}) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SNIPPET_TEMPLATES;
    return SNIPPET_TEMPLATES.filter((t) =>
      [t.title, t.description, t.tags.join(' '), getSnippetLanguage(t.language).name].join(' ').toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Snippet templates"
      description="Start a new snippet from a template. Nothing is saved until you press Save."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button icon={Library} onClick={onAddAll}>
            Add all {SNIPPET_TEMPLATES.length} to library
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter templates…"
          aria-label="Filter templates"
          className="pl-9"
        />
      </div>
      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-fg-muted">No template matches “{query}”.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onUse(t)}
                className="flex h-full w-full flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent-line hover:bg-surface-hover"
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="text-[13.5px] font-medium text-fg">{t.title}</span>
                  <Badge>{getSnippetLanguage(t.language).name}</Badge>
                </span>
                <span className="text-[12.5px] text-fg-muted">{t.description}</span>
                <CodePreview code={t.code} language={t.language} lines={3} className="mt-1 w-full rounded-md bg-surface-sunken px-2 py-1.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export interface PendingImport {
  fileName: string;
  parsed: ParsedImport;
}

export function ImportDialog({
  pending,
  existing,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport | null;
  existing: Snippet[];
  onCancel: () => void;
  onConfirm: (strategy: ConflictStrategy) => void;
}) {
  const [strategy, setStrategy] = useState<ConflictStrategy>('keep-both');
  const preview = useMemo(
    () => (pending ? planImport(existing, pending.parsed.snippets, strategy, () => '') : null),
    [pending, existing, strategy],
  );
  const parsed = pending?.parsed;
  const nothing = preview ? preview.toPut.length === 0 : true;

  return (
    <Dialog
      open={pending !== null}
      onClose={onCancel}
      title="Import snippets"
      description={pending?.fileName}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={nothing} onClick={() => onConfirm(strategy)}>
            {preview && !nothing ? `Import ${pluralize(preview.toPut.length, 'snippet')}` : 'Nothing to import'}
          </Button>
        </>
      }
    >
      {parsed && preview && (
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="text-fg-secondary">
            Found {pluralize(parsed.snippets.length, 'valid snippet')}
            {parsed.errors.length > 0 && <> and skipped {pluralize(parsed.errors.length, 'invalid item')}</>}.
          </p>
          {preview.conflicts > 0 && (
            <div>
              <p className="mb-1.5 font-medium text-fg">
                {pluralize(preview.conflicts, 'snippet')} {preview.conflicts === 1 ? 'has' : 'have'} the same id as an
                existing one but different content:
              </p>
              <Segmented
                label="When ids conflict"
                value={strategy}
                onChange={setStrategy}
                options={[
                  { value: 'keep-both', label: 'Keep both' },
                  { value: 'replace', label: 'Replace existing' },
                  { value: 'skip', label: 'Skip' },
                ]}
              />
            </div>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryStat label="New" value={preview.added} />
            <SummaryStat label={strategy === 'replace' ? 'Replaced' : strategy === 'skip' ? 'Skipped' : 'Copied'} value={strategy === 'replace' ? preview.replaced : strategy === 'skip' ? preview.skipped : preview.copied} />
            <SummaryStat label="Unchanged" value={preview.unchanged} />
            <SummaryStat label="Invalid" value={parsed.errors.length} tone={parsed.errors.length ? 'danger' : undefined} />
          </ul>
          {parsed.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          {parsed.errors.length > 0 && (
            <details className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
              <summary className="text-fg-secondary">Show skipped items</summary>
              <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-[12.5px] text-fg-muted">
                {parsed.errors.slice(0, 200).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {parsed.errors.length > 200 && <li>…and {parsed.errors.length - 200} more</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <li className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className={cn('font-mono text-[16px] font-semibold tabular-nums', tone === 'danger' && value ? 'text-danger' : 'text-fg')}>
        {formatNumber(value, 0)}
      </div>
    </li>
  );
}

const SHORTCUTS: Array<[string[], string]> = [
  [[modKey, 'N'], 'New snippet (Alt+N or N if the browser reserves Ctrl+N)'],
  [['/'], 'Focus search'],
  [['↑', '↓'], 'Move through the list'],
  [['Enter'], 'Open the highlighted snippet'],
  [[modKey, 'S'], 'Save while editing (also Ctrl+Enter)'],
  [['Esc'], 'Cancel editing / clear search'],
  [[modKey, 'Shift', 'C'], 'Copy code of the open snippet (or C)'],
  [['E'], 'Edit the open snippet'],
  [['F'], 'Toggle favorite'],
  [['?'], 'Show this help'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <p className="mb-3 text-[12.5px] text-fg-muted">Single-key shortcuts work when you are not typing in a field.</p>
      <dl className="divide-y divide-line text-[13px]">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-fg-secondary">{label}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
