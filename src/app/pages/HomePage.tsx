import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, CloudOff, HardDrive, Search, ShieldCheck, X } from 'lucide-react';
import { populatedCategories, resolveTools, searchTools, toolPath, toolsInCategory, TOOLS } from '@/tools/registry';
import { recordSearch, useFavorites, usePinned, useRecentTools } from '@/lib/userPrefs';
import { ToolCard, ToolGrid } from '@/components/ToolCard';
import { ToolIcon } from '@/components/ToolIcon';
import { Kbd } from '@/components/ui/Panel';
import { modKey } from '@/lib/utils';
import { useDocumentTitle } from '../useDocumentTitle';

const QUICK_QUERIES = ['format json', 'merge pdf', 'compress image', 'decode jwt', 'csv to json', 'regex', 'diagram'];

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function HomePage() {
  useDocumentTitle(null);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const pinned = resolveTools(usePinned());
  const favorites = resolveTools(useFavorites());
  const recent = resolveTools(useRecentTools()).slice(0, 8);
  const categories = populatedCategories();
  const workspaces = toolsInCategory('workspace');

  const results = useMemo(() => (query.trim() ? searchTools(query, 60).map((r) => r.item) : []), [query]);

  // Keep ?q= in sync so searches are shareable and survive refresh.
  useEffect(() => {
    const id = setTimeout(() => {
      const q = query.trim();
      if ((params.get('q') ?? '') !== q) setParams(q ? { q } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [query, params, setParams]);

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  const personal = [...pinned, ...favorites.filter((t) => !pinned.includes(t))];

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[420px] overflow-hidden" aria-hidden>
        <div className="lk-grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute -top-40 left-1/2 h-[380px] w-[760px] -translate-x-1/2 rounded-full bg-[var(--lk-glow-a)] blur-[90px]" />
        <div className="absolute -top-24 left-[62%] h-[220px] w-[360px] rounded-full bg-[var(--lk-glow-b)] blur-[90px]" />
      </div>

      <div className="relative mx-auto max-w-[1240px] px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-4 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12px] text-fg-secondary backdrop-blur">
            <span className="inline-flex items-center gap-1.5">
              <HardDrive size={12} aria-hidden /> Runs on your device
            </span>
            <span className="text-line-strong" aria-hidden>
              /
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={12} aria-hidden /> No uploads
            </span>
            <span className="text-line-strong" aria-hidden>
              /
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CloudOff size={12} aria-hidden /> Works offline
            </span>
          </div>
          <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance text-fg sm:text-[46px]">
            Every tool you reach for.
            <br className="hidden sm:block" /> <span className="text-fg-secondary">None of your data leaves.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-pretty text-fg-secondary sm:text-base">
            {TOOLS.length} fast utilities for PDFs, images, JSON, text, data and code — processed locally in your browser.
          </p>

          <form
            role="search"
            className="relative mt-7"
            onSubmit={(e) => {
              e.preventDefault();
              if (results[0]) {
                recordSearch(query);
                navigate(toolPath(results[0]));
              }
            }}
          >
            <Search size={19} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you need? Try “jpg to webp” or “decode jwt”"
              aria-label="Search tools"
              autoComplete="off"
              spellCheck={false}
              className="h-14 w-full rounded-xl border border-line-strong bg-surface-raised pr-24 pl-12 text-[16px] text-fg shadow-raised transition-[border-color,box-shadow] outline-none placeholder:text-fg-muted focus:border-accent focus:shadow-[0_0_0_4px_var(--lk-accent-soft)] [&::-webkit-search-cancel-button]:hidden"
            />
            <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1">
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                  className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                  aria-label="Clear search"
                >
                  <X size={16} aria-hidden />
                </button>
              ) : (
                <span className="hidden items-center gap-1 sm:flex" aria-hidden>
                  <Kbd>{modKey}</Kbd>
                  <Kbd>K</Kbd>
                </span>
              )}
            </div>
          </form>
          {!query && (
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {QUICK_QUERIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuery(q)}
                  className="rounded-full border border-line bg-surface/80 px-3 py-1 text-[12.5px] text-fg-secondary transition-colors hover:border-line-strong hover:text-fg"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-12 sm:mt-14">
          {query.trim() ? (
            <Section title={results.length ? `${results.length} matching tool${results.length === 1 ? '' : 's'}` : 'No matches'}>
              <div aria-live="polite">
                {results.length ? (
                  <ToolGrid tools={results} />
                ) : (
                  <p className="rounded-xl border border-dashed border-line-strong px-6 py-10 text-center text-sm text-fg-muted">
                    Nothing matches “{query.trim()}”. Try a file format (pdf, png, csv) or an action (merge, format, decode).
                  </p>
                )}
              </div>
            </Section>
          ) : (
            <>
              {personal.length > 0 && (
                <Section
                  title="Your tools"
                  action={
                    <Link to="/favorites" className="text-[13px] text-fg-muted hover:text-fg">
                      Manage
                    </Link>
                  }
                >
                  <ToolGrid tools={personal.slice(0, 8)} variant="compact" />
                </Section>
              )}
              {recent.length > 0 && (
                <Section title="Recently used">
                  <ToolGrid tools={recent} variant="compact" />
                </Section>
              )}

              {workspaces.length > 0 && (
                <Section title="Workspaces">
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {workspaces.map((tool) => (
                      <li key={tool.id} className="min-w-0">
                        <Link
                          to={toolPath(tool)}
                          className="group flex h-full flex-col rounded-xl border border-line bg-surface p-4 shadow-card transition-[border-color,box-shadow,background-color] hover:border-line-strong hover:bg-surface-raised hover:shadow-raised"
                        >
                          <div className="flex items-center justify-between">
                            <ToolIcon icon={tool.icon} hue={217} size="lg" />
                            <ArrowRight
                              size={16}
                              aria-hidden
                              className="text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
                            />
                          </div>
                          <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-fg">{tool.name}</h3>
                          <p className="mt-1 text-[13px] leading-snug text-fg-muted">{tool.description}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {categories
                .filter((c) => c.id !== 'workspace')
                .map((category) => {
                  const tools = toolsInCategory(category.id);
                  const shown = tools.slice(0, 8);
                  return (
                    <Section
                      key={category.id}
                      title={category.name}
                      action={
                        <Link
                          to={`/category/${category.id}`}
                          className="inline-flex items-center gap-1 text-[13px] text-fg-muted hover:text-fg"
                        >
                          {tools.length > shown.length ? `All ${tools.length}` : 'Open category'}
                          <ArrowRight size={13} aria-hidden />
                        </Link>
                      }
                    >
                      <ul className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {shown.map((tool) => (
                          <li key={tool.id} className="min-w-0">
                            <ToolCard tool={tool} />
                          </li>
                        ))}
                      </ul>
                    </Section>
                  );
                })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
