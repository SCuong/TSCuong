import { useMemo, useRef, useState } from 'react';
import { FileArchive, FolderDown, RotateCcw, TextCursorInput, TriangleAlert, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Input, Label, NumberInput, Select } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useAsyncJob, useToolState } from '@/lib/hooks';
import { cn, downloadBlob, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import {
  computeNames,
  DEFAULT_OPTIONS,
  findProblems,
  PROBLEM_TEXT,
  sortFiles,
  type CaseMode,
  type ExtMode,
  type RenameOptions,
  type SortMode,
} from './lib/rename';
import { buildZip } from './lib/zipBuild';
import { existingFiles } from './lib/folderWrite';
import { useOverwritePrompt } from './components/OverwritePrompt';

interface Item {
  id: number;
  file: File;
  name: string;
  size: number;
  lastModified: number;
  path?: string;
}

let seq = 0;
const TOKENS: Array<{ token: string; title: string }> = [
  { token: '{name}', title: 'Original name without extension' },
  { token: '{n:3}', title: 'Counter, padded to 3 digits' },
  { token: '{date}', title: 'Last-modified date (YYYY-MM-DD)' },
  { token: '{date:YYYYMMDD-HHmmss}', title: 'Last-modified date and time' },
  { token: '{ext}', title: 'Original extension' },
  { token: '{size}', title: 'Size in bytes' },
  { token: '{parent}', title: 'Parent folder (when a folder was added)' },
];
const SHOWN = 500;
const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
type DirPicker = {
  showDirectoryPicker: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
};

export default function BatchRenamer() {
  const [items, setItems] = useState<Item[]>([]);
  const [opts, setOpts] = useToolState<RenameOptions>('batch-file-renamer', 'options', DEFAULT_OPTIONS);
  const [zipName, setZipName] = useState('renamed.zip');
  const [error, setError] = useState<string | null>(null);
  const patternRef = useRef<HTMLInputElement>(null);
  const job = useAsyncJob();
  const overwrite = useOverwritePrompt();
  const o: RenameOptions = { ...DEFAULT_OPTIONS, ...opts };
  const set = <K extends keyof RenameOptions>(key: K, value: RenameOptions[K]) =>
    setOpts((prev) => ({ ...DEFAULT_OPTIONS, ...prev, [key]: value }));

  function add(files: File[]) {
    setItems((list) => [
      ...list,
      ...files.map((file) => ({
        id: ++seq,
        file,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
      })),
    ]);
  }

  function insertToken(token: string) {
    const input = patternRef.current;
    const value = o.pattern;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    set('pattern', value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const sorted = useMemo(() => sortFiles(items, o.sort), [items, o.sort]);
  const computed = useMemo(() => {
    try {
      return { names: computeNames(sorted, o), error: null };
    } catch (e) {
      return { names: sorted.map((f) => f.name), error: errorMessage(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, JSON.stringify(o)]);
  const problems = useMemo(() => findProblems(computed.names), [computed.names]);
  const problemCount = problems.filter((p) => p.length).length;
  const changed = computed.names.filter((n, i) => n !== sorted[i].name).length;
  const blocked = Boolean(computed.error) || problemCount > 0 || items.length === 0;

  async function downloadZip() {
    setError(null);
    try {
      const blob = await job.run(({ signal, progress }) =>
        buildZip(
          sorted.map((it, i) => ({ path: computed.names[i], file: it.file })),
          0,
          (f) => progress(f, 'Packing files…'),
          signal,
        ),
      );
      const name = zipName.trim() ? (/\.zip$/i.test(zipName.trim()) ? zipName.trim() : `${zipName.trim()}.zip`) : 'renamed.zip';
      downloadBlob(blob, name);
      toast(`Created ${name} (${formatBytes(blob.size)})`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e, 'Could not create the ZIP file.'));
    }
  }

  async function saveToFolder() {
    setError(null);
    let root: FileSystemDirectoryHandle;
    try {
      root = await (window as unknown as DirPicker).showDirectoryPicker({
        mode: 'readwrite',
      });
    } catch {
      return;
    }
    // Never replace files silently: in the originals' own folder that could destroy an original that
    // hasn't been copied yet (a→b while b is still waiting to be copied).
    let existing: Set<string>;
    try {
      existing = new Set(await existingFiles(root, computed.names));
    } catch (e) {
      setError(errorMessage(e, 'The folder could not be read.'));
      return;
    }
    let keepExisting = false;
    if (existing.size) {
      const choice = await overwrite.ask(
        [...existing],
        'If this is the folder the originals are in, choose another folder: replacing can overwrite originals before they are copied.',
      );
      if (choice === 'cancel') return;
      keepExisting = choice === 'skip';
    }
    let saved = 0;
    let kept = 0;
    try {
      await job.run(async ({ signal, progress }) => {
        for (let i = 0; i < sorted.length; i++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          progress(i / sorted.length, computed.names[i]);
          if (keepExisting && existing.has(computed.names[i])) {
            kept++;
            continue;
          }
          const handle = await root.getFileHandle(computed.names[i], {
            create: true,
          });
          const w = await handle.createWritable();
          await w.write(sorted[i].file);
          await w.close();
          saved++;
        }
      });
      toast(`Saved ${pluralize(saved, 'renamed copy', 'renamed copies')}${kept ? `; kept ${pluralize(kept, 'existing file')}` : ''}.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e, 'Could not save the files.'));
    }
  }

  return (
    <ToolStack>
      {overwrite.dialog}
      <FileDrop
        multiple
        onFiles={add}
        icon={TextCursorInput}
        compact={items.length > 0}
        title="Drop the files to rename"
        hint="Your originals are untouched: you get renamed copies as a ZIP (or saved to a folder). Nothing is uploaded."
      />
      <Panel
        title="Rename rules"
        actions={
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setOpts(DEFAULT_OPTIONS)}>
            Reset
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor="rn-pattern">Name pattern</Label>
            <Input
              id="rn-pattern"
              ref={patternRef}
              mono
              value={o.pattern}
              onChange={(e) => set('pattern', e.target.value)}
              placeholder="{name}"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  title={t.title}
                  onClick={() => insertToken(t.token)}
                  className="rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[12px] text-fg-secondary hover:border-accent-line hover:text-accent-text"
                >
                  {t.token}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-fg-muted">The extension is added automatically; control it below.</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="rn-find">Find</Label>
              <Input
                id="rn-find"
                mono
                value={o.find}
                onChange={(e) => set('find', e.target.value)}
                placeholder={o.regex ? '(\\d+)' : 'text'}
                aria-invalid={Boolean(computed.error) || undefined}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="rn-replace">Replace with</Label>
              <Input
                id="rn-replace"
                mono
                value={o.replace}
                onChange={(e) => set('replace', e.target.value)}
                placeholder={o.regex ? '$1' : ''}
              />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2">
              <Checkbox label="Regular expression" checked={o.regex} onChange={(v) => set('regex', v)} />
              <Checkbox label="Match case" checked={o.matchCase} onChange={(v) => set('matchCase', v)} />
              <Checkbox label="Replace all" checked={o.replaceAll} onChange={(v) => set('replaceAll', v)} />
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="min-w-0">
            <Label htmlFor="rn-case">Case</Label>
            <Select id="rn-case" value={o.caseMode} onChange={(e) => set('caseMode', e.target.value as CaseMode)}>
              <option value="keep">Keep</option>
              <option value="lower">lowercase</option>
              <option value="upper">UPPERCASE</option>
              <option value="title">Title Case</option>
              <option value="camel">camelCase</option>
              <option value="kebab">kebab-case</option>
              <option value="snake">snake_case</option>
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="rn-ext">Extension</Label>
            <Select id="rn-ext" value={o.extMode} onChange={(e) => set('extMode', e.target.value as ExtMode)}>
              <option value="keep">Keep</option>
              <option value="lower">lowercase</option>
              <option value="upper">UPPERCASE</option>
              <option value="change">Change to…</option>
              <option value="remove">Remove</option>
            </Select>
          </div>
          {o.extMode === 'change' && (
            <div className="min-w-0">
              <Label htmlFor="rn-newext">New extension</Label>
              <Input id="rn-newext" mono value={o.newExt} onChange={(e) => set('newExt', e.target.value)} placeholder="jpg" />
            </div>
          )}
          <div className="min-w-0">
            <Label htmlFor="rn-start">Counter start</Label>
            <NumberInput id="rn-start" step={1} value={o.start} onChange={(v) => set('start', v === '' ? 1 : Math.trunc(v))} />
          </div>
          <div className="min-w-0">
            <Label htmlFor="rn-step">Step</Label>
            <NumberInput id="rn-step" step={1} value={o.step} onChange={(v) => set('step', v === '' ? 1 : Math.trunc(v))} />
          </div>
          <div className="min-w-0">
            <Label htmlFor="rn-sort">Number in order of</Label>
            <Select id="rn-sort" value={o.sort} onChange={(e) => set('sort', e.target.value as SortMode)}>
              <option value="original">Order added</option>
              <option value="name">Name</option>
              <option value="date">Date modified</option>
              <option value="size">Size</option>
            </Select>
          </div>
        </div>
        <Checkbox
          className="mt-3"
          label="Collapse repeated spaces and trim"
          checked={o.collapseSpaces}
          onChange={(v) => set('collapseSpaces', v)}
        />
      </Panel>
      <ErrorMessage error={computed.error} />
      <ErrorMessage error={error} />
      {items.length > 0 && (
        <>
          {problemCount > 0 && (
            <Alert tone="warning" title={`${pluralize(problemCount, 'name')} can't be used`}>
              Fix the highlighted names (duplicates, characters Windows forbids, reserved names such as CON or NUL) before downloading.
            </Alert>
          )}
          <Panel
            title={`${pluralize(items.length, 'file')} · ${changed} renamed`}
            bodyClassName="p-0"
            actions={
              <>
                <Input
                  aria-label="ZIP file name"
                  className="h-8 w-40 py-1 text-[13px]"
                  value={zipName}
                  onChange={(e) => setZipName(e.target.value)}
                />
                <Button size="sm" variant="primary" icon={FileArchive} disabled={blocked || job.running} onClick={() => void downloadZip()}>
                  Download ZIP
                </Button>
                {canPickFolder && (
                  <Button size="sm" icon={FolderDown} disabled={blocked || job.running} onClick={() => void saveToFolder()}>
                    Save to folder…
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={job.running} onClick={() => setItems([])}>
                  Clear
                </Button>
              </>
            }
          >
            {job.running && (
              <div className="border-b border-line px-4 py-2.5">
                <ProgressBar value={job.progress} label={job.label} onCancel={job.cancel} />
              </div>
            )}
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-surface text-left text-[11.5px] font-medium tracking-wide text-fg-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="w-10 px-2 py-2 text-right font-medium sm:px-3">#</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Original</th>
                    <th className="px-3 py-2 font-medium">New name</th>
                    <th className="w-8 px-2 py-2">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, SHOWN).map((it, i) => {
                    const name = computed.names[i];
                    const p = problems[i];
                    return (
                      // No row tint: the red badges on a tinted row fell below 4.5:1 contrast. The name and badges carry it.
                      <tr key={it.id} className="border-b border-line last:border-0">
                        <td className="px-2 py-1.5 text-right align-top font-mono text-[12px] text-fg-muted tabular-nums sm:px-3 sm:align-middle">
                          {i + 1}
                        </td>
                        <td className="hidden max-w-0 px-3 py-1.5 sm:table-cell">
                          <span className="block truncate font-mono text-[12.5px] text-fg-secondary" title={it.path ?? it.name}>
                            {it.name}
                          </span>
                        </td>
                        <td className="max-w-0 px-3 py-1.5">
                          <span className="block truncate font-mono text-[12px] text-fg-muted sm:hidden" title={it.path ?? it.name}>
                            {it.name} →
                          </span>
                          <span
                            className={cn(
                              'block truncate font-mono text-[12.5px]',
                              p.length ? 'text-danger' : name !== it.name ? 'text-fg' : 'text-fg-muted',
                            )}
                            title={name}
                          >
                            {name || '(empty)'}
                          </span>
                          {p.length > 0 && (
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {p.map((x) => (
                                <Badge key={x} tone="danger">
                                  <TriangleAlert size={11} aria-hidden /> {PROBLEM_TEXT[x]}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <IconButton
                            icon={X}
                            size="sm"
                            label={`Remove ${it.name}`}
                            disabled={job.running}
                            onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sorted.length > SHOWN && (
              <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
                Showing the first {SHOWN} of {sorted.length.toLocaleString()} files. All of them are renamed.
                {problemCount > 0 && ' Problems in hidden rows are included in the count above.'}
              </p>
            )}
          </Panel>
        </>
      )}
    </ToolStack>
  );
}
