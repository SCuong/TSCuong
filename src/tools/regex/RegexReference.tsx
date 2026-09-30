import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Check, Search, X } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { CopyButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { Input, Label } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { CHEAT_SHEET, type CheatRow } from './lib/cheatsheet';
import { FLAGS, isFlagSupported } from './lib/flags';
import { toRegexLiteral } from './lib/literal';
import { findMatches } from './lib/match';
import {
  COMMON_PATTERNS,
  PATTERN_CATEGORIES,
  patternSampleText,
  patternTesterFlags,
  type CommonPattern,
  type PatternCategory,
} from './lib/patterns';
import { REPLACEMENT_TOKENS } from './lib/replace';
import { VisibleText } from './components/MatchList';
import { t } from '@/lib/i18n';

const ID = 'regex-reference';

type View = 'patterns' | 'cheatsheet';
type CategoryFilter = 'all' | PatternCategory;

function testerHref(pattern: string, flags: string, text?: string): string {
  const params = new URLSearchParams({ pattern, flags });
  if (text !== undefined) params.set('text', text);
  return `/tools/regex?${params.toString()}`;
}

function matchesQuery(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}

export default function RegexReference() {
  const [view, setView] = useToolState<View>(ID, 'view', 'patterns');
  const [query, setQuery] = useToolState(ID, 'query', '');
  const [category, setCategory] = useToolState<CategoryFilter>(ID, 'category', 'all');

  const patterns = useMemo(
    () =>
      COMMON_PATTERNS.filter(
        (p) =>
          (category === 'all' || p.category === category) &&
          matchesQuery(query, p.name, p.description, p.pattern, p.category, p.note ?? ''),
      ),
    [category, query],
  );

  const sections = useMemo(
    () =>
      CHEAT_SHEET.map((s) => ({
        ...s,
        rows: matchesQuery(query, s.title) ? s.rows : s.rows.filter((r) => matchesQuery(query, r.token, r.description)),
      })).filter((s) => s.rows.length > 0),
    [query],
  );

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>{t('Show')}</Label>
          <Segmented
            label={t('Show')}
            value={view}
            onChange={setView}
            options={[
              { value: 'patterns', label: t('Common patterns') },
              { value: 'cheatsheet', label: t('Cheat sheet') },
            ]}
          />
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <Label htmlFor="regex-ref-search">{t('Search')}</Label>
          <div className="relative">
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" />
            <Input
              id="regex-ref-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={view === 'patterns' ? t('email, date, ipv6…') : t('lookahead, \\b, lazy…')}
              className="pl-8"
              type="search"
            />
          </div>
        </div>
        {view === 'patterns' && (
          <div className="min-w-0 max-w-full">
            <Label>{t('Category')}</Label>
            <Segmented
              label={t('Category')}
              size="sm"
              value={category}
              onChange={setCategory}
              className="h-9"
              options={[{ value: 'all' as const, label: t('All') }, ...PATTERN_CATEGORIES.map((c) => ({ value: c, label: c }))]}
            />
          </div>
        )}
      </ToolBar>

      {view === 'patterns' ? (
        patterns.length ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            {patterns.map((p) => (
              <PatternCard key={p.id} pattern={p} />
            ))}
          </div>
        ) : (
          <Panel>
            <EmptyState icon={Search} title={t('No patterns match your search')}>
              {t('Try a broader word, or switch the category to All.')}
            </EmptyState>
          </Panel>
        )
      ) : (
        <CheatSheet sections={sections} query={query} />
      )}
    </ToolStack>
  );
}

function PatternCard({ pattern: p }: { pattern: CommonPattern }) {
  const literal = toRegexLiteral(p.pattern, p.flags);
  const needsUnsupported = [...p.flags].some((f) => !isFlagSupported(f));

  return (
    <Panel
      title={p.name}
      description={p.category}
      bodyClassName="flex flex-col gap-3"
      actions={
        <>
          <CopyButton value={literal} label={t('Copy')} variant="ghost" />
          <Link
            to={testerHref(p.pattern, patternTesterFlags(p), patternSampleText(p))}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2.5 text-[13px] font-medium text-fg shadow-card hover:bg-surface-hover"
          >
            {t('Open in tester')}
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        </>
      }
    >
      <p className="text-[13px] text-fg-secondary">{p.description}</p>
      <code className="block rounded-lg border border-line bg-surface-sunken px-3 py-2 font-mono text-[12.5px] leading-relaxed break-all text-fg">
        {literal}
      </code>
      {needsUnsupported ? (
        <p className="text-[12.5px] text-warning">{t('This pattern needs a flag your browser does not support.')}</p>
      ) : p.kind === 'validate' ? (
        <ExampleList pattern={p} />
      ) : (
        <FindSample pattern={p} />
      )}
      {p.note && <p className="text-[12.5px] text-fg-muted">{p.note}</p>}
    </Panel>
  );
}

/** Positive and negative examples, each checked live against the pattern. */
function ExampleList({ pattern: p }: { pattern: CommonPattern }) {
  const re = new RegExp(p.pattern, p.flags);
  const rows = [
    ...(p.examples?.match ?? []).map((s) => ({ s, expected: true })),
    ...(p.examples?.noMatch ?? []).map((s) => ({ s, expected: false })),
  ];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('Examples')}>
      {rows.map(({ s, expected }) => {
        const ok = re.test(s);
        return (
          <li
            key={`${expected}-${s}`}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[12px]',
              ok ? 'border-transparent bg-success-soft text-success' : 'border-line bg-surface-sunken text-fg-muted',
            )}
          >
            {ok ? <Check size={12} aria-label="matches" className="shrink-0" /> : <X size={12} aria-label={t('no match')} className="shrink-0" />}
            <span className="min-w-0 break-all">{s}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A sample text with the pattern's matches highlighted. */
function FindSample({ pattern: p }: { pattern: CommonPattern }) {
  const text = p.sample ?? '';
  const { matches } = findMatches(p.pattern, p.flags, text);
  const parts: ReactNode[] = [];
  let last = 0;
  matches.forEach((m, i) => {
    if (m.index > last) parts.push(<VisibleText key={`t${i}`} text={text.slice(last, m.index)} />);
    parts.push(
      <mark key={`m${i}`} className={cn('rounded-[3px] text-fg', i % 2 ? 'lk-hl-match-alt' : 'lk-hl-match')}>
        <VisibleText text={m.text} />
      </mark>,
    );
    last = m.end;
  });
  if (last < text.length) parts.push(<VisibleText key="end" text={text.slice(last)} />);
  return (
    <div>
      <p className="mb-1 text-[12px] text-fg-muted">
        {(matches.length === 1) ? t('{count} match in the sample:', { count: matches.length }) : t('{count} matches in the sample:', { count: matches.length })}
      </p>
      <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg">
        {parts}
      </p>
    </div>
  );
}

function CheatSheet({ sections, query }: { sections: typeof CHEAT_SHEET; query: string }) {
  const flags = FLAGS.filter((f) => matchesQuery(query, 'flags', f.flag, f.name, f.description));
  const tokens = REPLACEMENT_TOKENS.filter((t) => matchesQuery(query, 'replacement', 'replace', t.token, t.description));
  if (!sections.length && !flags.length && !tokens.length) {
    return (
      <Panel>
        <EmptyState icon={Search} title={t('Nothing in the cheat sheet matches your search')} />
      </Panel>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      {sections.map((section) => (
        <Panel key={section.title} title={section.title} bodyClassName="p-0">
          <CheatTable rows={section.rows} />
        </Panel>
      ))}
      {flags.length > 0 && (
        <Panel title={t('Flags')} bodyClassName="p-0">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-line">
              {flags.map((f) => (
                <tr key={f.flag}>
                  <td className="w-16 px-4 py-2 align-top">
                    <code className="font-mono font-semibold text-accent-text">{f.flag}</code>
                  </td>
                  <td className="py-2 pr-4 text-fg-secondary">
                    <span className="text-fg">{f.name}</span> · {f.description}
                    {!isFlagSupported(f.flag) && <Badge tone="warning" className="ml-2">{t('Not supported here')}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {tokens.length > 0 && (
        <Panel title={t('Replacement tokens')} bodyClassName="p-0">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-line">
              {tokens.map((t) => (
                <tr key={t.token}>
                  <td className="w-28 px-4 py-2 align-top whitespace-nowrap">
                    <code className="font-mono text-fg">{t.token}</code>
                  </td>
                  <td className="py-2 pr-4 text-fg-secondary">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function CheatTable({ rows }: { rows: CheatRow[] }) {
  return (
    <table className="w-full table-fixed text-[13px]">
      <tbody className="divide-y divide-line">
        {rows.map((row) => {
          const example = row.example ?? row.token;
          const flags = row.flags ?? '';
          const usable = [...flags].every(isFlagSupported);
          return (
            <tr key={row.token}>
              <td className="w-[38%] px-4 py-2 align-top">
                <code className="font-mono break-all text-fg">{row.token}</code>
              </td>
              <td className="py-2 align-top text-fg-secondary">{row.description}</td>
              <td className="w-12 py-1.5 pr-2 text-right align-top">
                {usable && (
                  <Link
                    to={testerHref(example, flags ? `g${flags}` : 'g')}
                    aria-label={t('Try {example} in the tester', { example })}
                    title={t('Try in the tester')}
                    className="inline-flex size-7 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <ArrowUpRight size={15} aria-hidden />
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
