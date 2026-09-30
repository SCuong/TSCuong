import { useEffect, useMemo, useState } from 'react';
import { FileType } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Badge, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatNumber } from '@/lib/utils';
import { classifyQuery, lookupExtension, lookupType, searchMime, toEntries, type MimeEntry } from './lib/mime';
import { SearchBox } from './ref/ReferenceUI';

const PAGE = 100;
const EXAMPLES = ['png', '.mp4', 'report.pdf', 'application/json', 'text/html', 'font', 'svg'];

function Flags({ entry }: { entry: MimeEntry }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {entry.source && <Badge tone={entry.source === 'iana' ? 'accent' : 'neutral'}>{entry.source.toUpperCase()}</Badge>}
      {entry.compressible === true && <Badge tone="success">Compressible</Badge>}
      {entry.compressible === false && <Badge>Not compressible</Badge>}
      {entry.charset && <Badge>charset {entry.charset}</Badge>}
    </span>
  );
}

function Extensions({ list }: { list: string[] }) {
  if (list.length === 0) return <span className="text-fg-muted">No registered extensions</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((x) => (
        <code key={x} className="rounded border border-line bg-surface-sunken px-1.5 py-px font-mono text-[12px] text-fg">
          .{x}
        </code>
      ))}
    </span>
  );
}

export default function MimeTypeLookup() {
  const [entries, setEntries] = useState<MimeEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useToolState('mime-type-lookup', 'query', '');
  const [limit, setLimit] = useState(PAGE);
  const debounced = useDebouncedValue(query, 120);

  useEffect(() => {
    let cancelled = false;
    import('mime-db')
      .then((mod) => {
        if (!cancelled) setEntries(toEntries(mod.default));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error, 'The MIME database could not be loaded.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kind = classifyQuery(debounced);
  const results = useMemo(() => (entries ? searchMime(entries, debounced) : []), [entries, debounced]);
  const extLookup = useMemo(() => {
    if (!entries || kind !== 'extension') return null;
    const lookup = lookupExtension(entries, debounced);
    // A bare word such as "font" is usually a search term, not an extension: only report
    // "no MIME type for .font" when the user clearly typed an extension or a file name.
    const explicit = /^\.|\S\.\S/.test(debounced.trim());
    return lookup.preferred || explicit ? lookup : null;
  }, [entries, kind, debounced]);
  const typeLookup = useMemo(() => (entries && kind === 'type' ? lookupType(entries, debounced) : null), [entries, kind, debounced]);

  if (loadError) return <ErrorMessage error={loadError} title="Could not load the MIME database" />;
  if (!entries) {
    return (
      <Panel>
        <div className="flex justify-center py-10">
          <Spinner label="Loading the MIME type database…" />
        </div>
      </Panel>
    );
  }

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-3">
        <SearchBox
          value={query}
          onChange={(v) => {
            setQuery(v);
            setLimit(PAGE);
          }}
          placeholder="Extension (png, .tar.gz, photo.jpg) or type (application/json)"
          label="Search extensions and MIME types"
          count={results.length}
          total={entries.length}
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuery(ex)}
              className="rounded-md border border-line bg-surface-sunken px-2 py-0.5 font-mono text-[12px] text-fg-secondary hover:border-line-strong hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      </Panel>

      {extLookup && (
        <Panel title={`Extension .${extLookup.extension}`}>
          {extLookup.preferred ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[17px] font-semibold break-all text-fg">{extLookup.preferred.type}</code>
                <CopyButton value={extLookup.preferred.type} iconOnly label="Copy MIME type" />
                <Flags entry={extLookup.preferred} />
              </div>
              {extLookup.candidates.length > 1 && (
                <p className="text-[13px] text-fg-secondary">
                  {extLookup.candidates.length} types list this extension. The preferred one favours IANA-registered, non-vendor
                  types. Also used:{' '}
                  {extLookup.candidates.slice(1).map((c, i) => (
                    <span key={c.type}>
                      {i > 0 && ', '}
                      <code className="font-mono text-[12.5px] text-fg">{c.type}</code>
                    </span>
                  ))}
                  .
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-fg-secondary">
              No MIME type is registered for “.{extLookup.extension}”. Servers usually fall back to{' '}
              <code className="font-mono text-fg">application/octet-stream</code>.
            </p>
          )}
        </Panel>
      )}

      {kind === 'type' && debounced.trim() && (
        <Panel title="MIME type">
          {typeLookup ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[17px] font-semibold break-all text-fg">{typeLookup.type}</code>
                <CopyButton value={typeLookup.type} iconOnly label="Copy MIME type" />
                <Flags entry={typeLookup} />
              </div>
              <Extensions list={typeLookup.extensions} />
            </div>
          ) : (
            <p className="text-[13px] text-fg-secondary">“{debounced.trim()}” is not in the database. Partial matches are listed below.</p>
          )}
        </Panel>
      )}

      <Panel title={debounced.trim() ? 'Matches' : 'All types'} bodyClassName="p-0">
        {results.length === 0 ? (
          <EmptyState icon={FileType} title="No matches">
            Try a shorter word, an extension such as “png”, or a type such as “image/”.
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {results.slice(0, limit).map((e) => (
                <li key={e.type} className="px-4 py-2.5 hover:bg-surface-hover">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <code className="min-w-0 font-mono text-[13px] break-all text-fg">{e.type}</code>
                    <Flags entry={e} />
                  </div>
                  <p className="mt-0.5 font-mono text-[12.5px] break-words text-fg-secondary">
                    {e.extensions.length ? e.extensions.map((x) => `.${x}`).join('  ') : <span className="font-sans text-fg-muted">No extensions</span>}
                  </p>
                </li>
              ))}
            </ul>
            {results.length > limit && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12.5px] text-fg-muted">
                <span>
                  Showing {formatNumber(limit, 0)} of {formatNumber(results.length, 0)}
                </span>
                <Button size="sm" onClick={() => setLimit((l) => l + PAGE * 5)}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
      <p className="text-[12.5px] text-fg-muted">Data: mime-db (IANA, Apache and nginx media type lists), bundled with the app.</p>
    </ToolStack>
  );
}
