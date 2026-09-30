import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpen, Eraser, FlaskConical, ListTree, Regex, TextSearch, TimerOff } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { CopyButton } from '@/components/ui/Actions';
import { IconButton } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Label } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, formatDuration, formatNumber, pluralize } from '@/lib/utils';
import { HighlightTextarea } from './components/HighlightTextarea';
import { MatchList } from './components/MatchList';
import { ExplanationTree } from './components/ExplanationTree';
import { FlagToggles } from './components/FlagToggles';
import { compileRegex } from './lib/errors';
import { explainPattern } from './lib/explain';
import { FLAGS, isFlagSupported, normalizeFlags } from './lib/flags';
import type { RegexJob, RegexJobResult } from './lib/job';
import { toRegExpConstructor, toRegexLiteral } from './lib/literal';
import { DEFAULT_MAX_DETAILS } from './lib/match';
import { REPLACEMENT_TOKENS } from './lib/replace';
import { RegexRunner, createRegexWorker } from './lib/runner';

const ID = 'regex-tester';
const TIMEOUT_MS = 2000;
const TIMEOUT_LABEL = '2 seconds';

const SAMPLE_PATTERN = '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)';
const SAMPLE_TEXT = `Contact alice@example.com or bob.smith+news@mail.example.org.
Not addresses: carol@, @dave.com, eve at example dot com
Ping frank_99@test.io 🎉`;
const SAMPLE_REPLACEMENT = '$<user> [at] $<domain>';

type Mode = 'match' | 'replace';

type RunState =
  | { status: 'idle' }
  | { status: 'done'; job: RegexJob; result: Extract<RegexJobResult, { ok: true }> }
  | { status: 'error'; job: RegexJob; error: string }
  | { status: 'timeout'; job: RegexJob };

export default function RegexTester() {
  const [pattern, setPattern] = useToolState(ID, 'pattern', '');
  const [flags, setFlagsRaw] = useToolState(ID, 'flags', 'g');
  const [text, setText] = useToolState(ID, 'text', '');
  const [mode, setMode] = useToolState<Mode>(ID, 'mode', 'match');
  const [replacement, setReplacement] = useToolState(ID, 'replacement', '');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Drop flags this browser does not support (e.g. a remembered "v" in an older browser).
  const safeFlags = useMemo(() => [...normalizeFlags(flags)].filter(isFlagSupported).join(''), [flags]);
  const setFlags = (next: string) => setFlagsRaw(normalizeFlags(next));

  // Load a pattern handed over from the reference page (?pattern=&flags=&text=), once.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.has('pattern')) return;
    setPattern(params.get('pattern') ?? '');
    setFlagsRaw(normalizeFlags(params.get('flags') ?? 'g'));
    if (params.has('text')) setText(params.get('text') ?? '');
    setMode('match');
    setParams({}, { replace: true });
  }, [params, setParams, setPattern, setFlagsRaw, setText, setMode]);

  const compiled = useMemo(() => (pattern ? compileRegex(pattern, safeFlags) : null), [pattern, safeFlags]);
  const valid = compiled?.ok === true;
  const explanation = useMemo(() => (valid ? explainPattern(pattern, safeFlags) : null), [valid, pattern, safeFlags]);

  const job = useMemo<RegexJob | null>(
    () =>
      valid
        ? { pattern, flags: safeFlags, text, replacement: mode === 'replace' ? replacement : null, maxDetails: DEFAULT_MAX_DETAILS }
        : null,
    [valid, pattern, safeFlags, text, mode, replacement],
  );
  const debouncedJob = useDebouncedValue(job, 120);

  const runner = useRef<RegexRunner | null>(null);
  useEffect(() => () => runner.current?.dispose(), []);

  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!debouncedJob) {
      setRun({ status: 'idle' });
      setBusy(false);
      return;
    }
    runner.current ??= new RegexRunner(createRegexWorker);
    let cancelled = false;
    setBusy(true);
    void runner.current.run(debouncedJob, TIMEOUT_MS).then((outcome) => {
      if (cancelled || outcome.status === 'superseded') return;
      setBusy(false);
      setActiveIndex(null);
      if (outcome.status === 'timeout') setRun({ status: 'timeout', job: debouncedJob });
      else if (outcome.result.ok) setRun({ status: 'done', job: debouncedJob, result: outcome.result });
      else setRun({ status: 'error', job: debouncedJob, error: outcome.result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedJob]);

  // Only show results that belong to the current input (never stale highlights on edited text).
  const current = run.status === 'done' && run.job.text === text ? run.result : null;
  const summary = current?.summary ?? null;
  const ranges = useMemo(() => summary?.matches.map((m) => ({ start: m.index, end: m.end })) ?? [], [summary]);
  const timedOut = run.status === 'timeout' && job !== null;
  const runError = run.status === 'error' && job !== null ? run.error : null;

  const literal = valid ? toRegexLiteral(pattern, safeFlags) : '';
  const constructorCode = valid ? toRegExpConstructor(pattern, safeFlags) : '';

  function selectMatch(index: number) {
    setActiveIndex(index);
    const m = summary?.matches[index];
    const el = textarea.current;
    if (!m || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(m.index, m.end);
  }

  function loadSample() {
    setPattern(SAMPLE_PATTERN);
    setFlagsRaw('g');
    setText(SAMPLE_TEXT);
    if (!replacement) setReplacement(SAMPLE_REPLACEMENT);
  }

  const countLabel = summary
    ? summary.total === 0
      ? 'No matches'
      : `${summary.capped ? `${formatNumber(summary.total, 0)}+` : formatNumber(summary.total, 0)} ${summary.total === 1 ? 'match' : 'matches'}`
    : null;

  const matchesPanel = (
    <Panel
      title="Matches"
      className={cn(mode === 'match' && 'lg:max-h-[512px]')}
      bodyClassName={cn('p-3', mode === 'match' && 'overflow-y-auto')}
      actions={
        <div className="flex items-center gap-2">
          {busy && <Spinner size={14} label="Matching…" />}
          {countLabel && !busy && <Badge tone={summary!.total ? 'accent' : 'neutral'}>{countLabel}</Badge>}
        </div>
      }
    >
      {!pattern ? (
        <EmptyState icon={Regex} title="Enter a pattern">
          Matches, their positions and capture groups appear here as you type.
        </EmptyState>
      ) : !valid ? (
        <EmptyState icon={Regex} title="Fix the pattern to see matches" />
      ) : !text ? (
        <EmptyState icon={TextSearch} title="Add some test text">
          Type or paste text on the left to try the pattern against it.
        </EmptyState>
      ) : timedOut ? (
        <EmptyState icon={TimerOff} title="Stopped: the pattern took too long" />
      ) : summary && summary.total === 0 ? (
        <EmptyState icon={TextSearch} title="No matches">
          {safeFlags.includes('y') ? 'The sticky flag (y) requires a match at the very start. ' : ''}
          Check the flags, or look at the explanation below to see what the pattern expects.
        </EmptyState>
      ) : summary ? (
        <>
          {summary.total > summary.matches.length && (
            <p className="mb-2 text-[12.5px] text-fg-muted">
              Showing details and highlights for the first {formatNumber(summary.matches.length, 0)} matches.
            </p>
          )}
          <MatchList
            key={`${pattern}/${safeFlags}`}
            matches={summary.matches}
            replacements={mode === 'replace' ? current!.replacements : null}
            activeIndex={activeIndex}
            onSelect={selectMatch}
          />
        </>
      ) : (
        <Spinner label="Matching…" className="p-2" />
      )}
    </Panel>
  );

  return (
    <ToolStack>
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label htmlFor="regex-pattern" className="text-[13px] font-medium text-fg-secondary">
            Regular expression
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <CopyButton value={literal} label="Copy /…/" />
            <CopyButton value={constructorCode} label="Copy new RegExp()" />
          </div>
        </div>
        <div
          className={cn(
            'flex min-w-0 items-center rounded-lg border bg-surface-sunken font-mono text-[14px] transition-[border-color,box-shadow] duration-100',
            compiled && !compiled.ok
              ? 'border-danger'
              : 'border-line-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--lk-accent-soft)]',
          )}
        >
          <span aria-hidden className="pl-3 text-fg-muted select-none">
            /
          </span>
          <input
            id="regex-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="e.g. (\d{4})-(\d{2})-(\d{2})"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            aria-invalid={(compiled && !compiled.ok) || undefined}
            aria-describedby={compiled && !compiled.ok ? 'regex-error' : undefined}
            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-fg outline-none placeholder:text-fg-muted"
          />
          <span aria-hidden className="pr-3 text-fg-muted select-none">
            /<span className="text-accent-text">{safeFlags}</span>
          </span>
        </div>
        <FlagToggles flags={safeFlags} onChange={setFlags} />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <Label>Mode</Label>
            <Segmented
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'match', label: 'Match' },
                { value: 'replace', label: 'Replace' },
              ]}
            />
          </div>
          {mode === 'replace' && (
            <div className="min-w-0 flex-1 basis-64">
              <Label htmlFor="regex-replacement">Replace with</Label>
              <input
                id="regex-replacement"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="$1, $<name>, $& (whole match), $$ (dollar)"
                spellCheck={false}
                autoComplete="off"
                className="lk-field h-9 font-mono text-[13px]"
              />
            </div>
          )}
          <Link
            to="/tools/regex/reference"
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-accent-text hover:bg-accent-soft"
          >
            <BookOpen size={14} aria-hidden />
            Common patterns & cheat sheet
          </Link>
        </div>
        {mode === 'replace' && (
          <p className="text-[12.5px] text-fg-muted">
            {REPLACEMENT_TOKENS.map((t, i) => (
              <span key={t.token}>
                {i > 0 && ' · '}
                <code className="font-mono text-fg-secondary">{t.token}</code> {t.description.toLowerCase()}
              </span>
            ))}
            {!safeFlags.includes('g') && ' · Without the g flag only the first match is replaced.'}
          </p>
        )}
      </section>

      {compiled && !compiled.ok && (
        <div id="regex-error">
          <Alert tone="danger" title="Invalid pattern">
            {compiled.error}
            {compiled.engine && !compiled.error.startsWith(compiled.engine.charAt(0).toUpperCase() + compiled.engine.slice(1)) && (
              <span className="mt-1 block text-[12.5px]">
                Your browser says: <span className="font-mono">{compiled.engine}</span>
              </span>
            )}
          </Alert>
        </div>
      )}
      <ErrorMessage error={runError} title="Matching failed" />
      {timedOut && (
        <Alert tone="warning" title={`The pattern took longer than ${TIMEOUT_LABEL} and was stopped`}>
          This usually means catastrophic backtracking: nested or overlapping repetition such as <code>(a+)+</code> or{' '}
          <code>(\w+\s?)*</code> can try exponentially many ways to match text that almost matches. Make the repeated
          parts unable to match the same characters, anchor the pattern, or use a more specific class.
        </Alert>
      )}

      <SplitPanes>
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
            <h2 className="text-[13px] font-semibold tracking-tight text-fg">Test text</h2>
            <div className="flex items-center gap-1">
              <IconButton icon={FlaskConical} label="Load sample" size="sm" onClick={loadSample} />
              <IconButton icon={Eraser} label="Clear" size="sm" disabled={!text} onClick={() => setText('')} />
              <CopyButton value={text} iconOnly />
            </div>
          </header>
          <div className="p-2">
            <HighlightTextarea
              ref={textarea}
              value={text}
              onChange={setText}
              ranges={ranges}
              activeIndex={activeIndex}
              ariaLabel="Test text"
              placeholder="Type or paste text to test the pattern against…"
              className="h-[300px] lg:h-[400px]"
            />
          </div>
          <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
            {text ? <span>{pluralize(text.length, 'character')}</span> : <span>Nothing is uploaded; matching runs in your browser.</span>}
            {countLabel && <span className="text-fg-secondary">{countLabel}</span>}
            {current && <span>{formatDuration(current.elapsedMs)}</span>}
          </footer>
        </section>

        {mode === 'replace' ? (
          <EditorPanel
            title="Result"
            value={current?.replaced ?? ''}
            placeholder={valid && text ? 'The replaced text appears here' : 'Enter a pattern and test text'}
            downloadName="replaced.txt"
            height="400px"
            footer={
              current && summary ? (
                <span>
                  {summary.total === 0
                    ? 'Nothing replaced'
                    : `${formatNumber(safeFlags.includes('g') ? summary.total : 1, 0)}${summary.capped ? '+' : ''} replaced`}
                </span>
              ) : undefined
            }
          />
        ) : (
          matchesPanel
        )}
      </SplitPanes>

      {mode === 'replace' && matchesPanel}

      <Panel
        title={
          <span className="inline-flex items-center gap-1.5">
            <ListTree size={14} aria-hidden className="text-fg-muted" />
            Explanation
          </span>
        }
        description={valid ? 'What each part of the pattern matches, in order.' : undefined}
      >
        {explanation ? (
          <div className="flex flex-col gap-3">
            {explanation.warnings.map((w) => (
              <Alert key={w} tone="warning" title="Possible catastrophic backtracking">
                {w}
              </Alert>
            ))}
            {explanation.nodes.length ? (
              <ExplanationTree nodes={explanation.nodes} />
            ) : (
              <p className="text-[13px] text-fg-muted">The empty pattern matches the empty string at every position.</p>
            )}
            {safeFlags && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[12.5px] text-fg-muted">
                {FLAGS.filter((f) => safeFlags.includes(f.flag)).map((f) => (
                  <span key={f.flag}>
                    <code className="font-mono font-semibold text-accent-text">{f.flag}</code> {f.description.toLowerCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-fg-muted">
            {pattern ? 'Fix the pattern to see its explanation.' : 'Enter a pattern to see a token-by-token explanation.'}
          </p>
        )}
      </Panel>
    </ToolStack>
  );
}
