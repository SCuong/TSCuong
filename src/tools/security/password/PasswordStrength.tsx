import { useEffect, useId, useMemo, useState } from 'react';
import { Eye, EyeOff, Gauge, ShieldCheck } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Field, Input, Label } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Panel, Stat } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue } from '@/lib/hooks';
import { cn, errorMessage, formatNumber } from '@/lib/utils';
import {
  ANALYSED_LENGTH,
  ATTACK_SCENARIOS,
  SCORE_INFO,
  charsetEntropy,
  describeMatch,
  guessesToBits,
  loadEstimator,
  type Estimator,
  type StrengthResult,
} from './lib/strength';

const TONE_BG = { danger: 'bg-danger', warning: 'bg-warning', success: 'bg-success' } as const;
const TONE_TEXT = { danger: 'text-danger', warning: 'text-warning', success: 'text-success' } as const;
const MATCH_COLORS = [
  'bg-[var(--lk-syn-keyword)]',
  'bg-[var(--lk-syn-function)]',
  'bg-[var(--lk-syn-property)]',
  'bg-[var(--lk-syn-tag)]',
  'bg-[var(--lk-syn-type)]',
];

/** Renders 10 raised to a (fractional) power, e.g. 10^7.3. */
function Power10({ log10, title }: { log10: number; title?: string }) {
  return (
    <span title={title}>
      10<sup className="ml-px text-[0.7em]">{log10.toFixed(1)}</sup>
    </span>
  );
}

function mask(text: string): string {
  return '•'.repeat(Array.from(text).length);
}

export default function PasswordStrength() {
  // The password lives only in component state: never persisted, logged or sent.
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [personal, setPersonal] = useState('');
  const [estimator, setEstimator] = useState<Estimator | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wantEngine, setWantEngine] = useState(false);
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!wantEngine && !password) return;
    let cancelled = false;
    loadEstimator()
      .then((fn) => !cancelled && setEstimator(() => fn))
      .catch((e) => !cancelled && setLoadError(errorMessage(e, 'The password dictionaries could not be loaded.')));
    return () => {
      cancelled = true;
    };
  }, [wantEngine, password]);

  const debounced = useDebouncedValue(password, 120);
  const personalWords = useMemo(() => personal.split(/[\s,;]+/).map((w) => w.trim()).filter((w) => w.length >= 2), [personal]);
  const result = useMemo<StrengthResult | null>(() => {
    if (!estimator || !debounced) return null;
    return estimator(debounced, personalWords);
  }, [estimator, debounced, personalWords]);
  const naive = useMemo(() => charsetEntropy(debounced), [debounced]);
  const stale = password !== debounced;

  return (
    <ToolStack>
      <Panel bodyClassName="flex flex-col gap-4">
        <div>
          <Label htmlFor={inputId}>Password to check</Label>
          <div className="relative">
            <Input
              id={inputId}
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setWantEngine(true)}
              placeholder="Type or paste a password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby={hintId}
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              className="h-11 pr-11 font-mono text-[15px]"
            />
            <IconButton
              icon={visible ? EyeOff : Eye}
              label={visible ? 'Hide password' : 'Show password'}
              aria-pressed={visible}
              onClick={() => setVisible((v) => !v)}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            />
          </div>
          <p id={hintId} className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-fg-muted">
            <ShieldCheck size={13} aria-hidden className="shrink-0 text-success" />
            Checked on this device only. The password is never sent anywhere, logged or saved.
          </p>
        </div>
        <Field
          label="Personal words (optional)"
          hint="Your name, username, email, birthday or the site’s name. Passwords that contain them rate lower. Not saved."
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={personal}
              onChange={(e) => setPersonal(e.target.value)}
              placeholder="e.g. alex, alex.smith@example.com, 1990"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
      </Panel>

      <ErrorMessage error={loadError} />

      {!password && (
        <Panel>
          <EmptyState icon={Gauge} title="Type a password to see how guessable it is">
            The estimate models real cracking tools: common passwords, dictionary words, names, keyboard patterns, dates,
            repeats and l33t substitutions, powered by zxcvbn.
          </EmptyState>
        </Panel>
      )}

      {password && !result && !loadError && (
        <Panel>
          <div className="flex justify-center py-10">
            <Spinner label="Preparing the password dictionaries…" />
          </div>
        </Panel>
      )}

      {password && result && (
        <div className="flex flex-col gap-4" aria-busy={stale || undefined}>
          <ScorePanel result={result} naiveBits={naive.bits} naivePool={naive.pool} length={naive.length} classes={naive.classes} />
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
            <CrackTimes result={result} />
            <Feedback result={result} />
          </div>
          <Patterns result={result} visible={visible} />
          {naive.length > ANALYSED_LENGTH && (
            <Alert tone="info">Only the first {ANALYSED_LENGTH} characters are analysed; anything that long is strong anyway.</Alert>
          )}
        </div>
      )}
    </ToolStack>
  );
}

function ScorePanel({
  result,
  naiveBits,
  naivePool,
  length,
  classes,
}: {
  result: StrengthResult;
  naiveBits: number;
  naivePool: number;
  length: number;
  classes: string[];
}) {
  const info = SCORE_INFO[result.score];
  const bits = guessesToBits(result.guessesLog10);
  return (
    <Panel bodyClassName="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <p className={cn('text-[18px] font-semibold', TONE_TEXT[info.tone])}>{info.label}</p>
          <p className="text-[13px] text-fg-secondary">{info.description}</p>
        </div>
        <p className="text-[13px] text-fg-muted">
          Score <span className="font-mono text-[15px] font-semibold text-fg">{result.score}</span> / 4
        </p>
      </div>
      <div
        className="grid grid-cols-5 gap-1.5"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={result.score}
        aria-valuetext={`${result.score} of 4: ${info.label}`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cn('h-2 rounded-full', i <= result.score ? TONE_BG[info.tone] : 'bg-surface-hover')} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Guesses to crack" value={<Power10 log10={result.guessesLog10} title={formatNumber(result.guesses, 0)} />} />
        <Stat label="zxcvbn entropy" value={`${bits.toFixed(1)} bits`} />
        <Stat label="Charset entropy" value={`${naiveBits.toFixed(1)} bits`} />
        <Stat label="Length" value={`${length} char${length === 1 ? '' : 's'}`} />
      </div>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        {result.sequence.some((m) => m.pattern !== 'bruteforce')
          ? `Charset entropy assumes every character was picked at random from a pool of ${naivePool} (${classes.join(', ')}), so it overrates human-made passwords. zxcvbn counts the guesses of a cracker that tries common passwords, words and patterns first${
              naiveBits - bits > 3 ? `: the patterns it found make this password about ${Math.round(naiveBits - bits)} bits weaker` : ''
            }.`
          : `No words or patterns were found, so this looks random. zxcvbn deliberately counts random characters low (about 10 guesses each), so here its figure is a floor and the charset entropy (${naiveBits.toFixed(0)} bits, a pool of ${naivePool} × ${length}) is closer if the password really was generated randomly.`}
      </p>
    </Panel>
  );
}

function CrackTimes({ result }: { result: StrengthResult }) {
  return (
    <Panel title="Time to crack">
      <dl className="divide-y divide-line">
        {ATTACK_SCENARIOS.map((s) => {
          const time = result.crackTimes[s.key];
          const fast = time.seconds < 3600;
          return (
            <div key={s.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
              <dt className="min-w-0">
                <span className="block text-[13px] text-fg">{s.label}</span>
                <span className="block text-[12px] text-fg-muted">{s.rate}</span>
              </dt>
              <dd className={cn('text-[14px] font-semibold', fast ? 'text-danger' : time.seconds < 3.15e7 ? 'text-warning' : 'text-success')}>
                {time.display}
              </dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}

function Feedback({ result }: { result: StrengthResult }) {
  const { warning, suggestions } = result.feedback;
  return (
    <Panel title="Feedback" bodyClassName="flex flex-col gap-3">
      {warning && <Alert tone="warning">{warning}</Alert>}
      {suggestions.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] text-fg-secondary">
          {suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : (
        !warning && (
          <p className="text-[13px] text-fg-secondary">
            No weak patterns found. Use it for one account only and keep it in a password manager.
          </p>
        )
      )}
      {result.score >= 3 && (warning || suggestions.length > 0) && (
        <p className="text-[12.5px] text-fg-muted">The score is already good; the notes above are optional improvements.</p>
      )}
    </Panel>
  );
}

function Patterns({ result, visible }: { result: StrengthResult; visible: boolean }) {
  const rows = result.sequence.map((match, i) => ({ match, i, ...describeMatch(match) }));
  return (
    <Panel title="How it would be guessed" description={visible ? undefined : 'Matched text is hidden while the password is hidden.'}>
      <div className="mb-4 flex flex-wrap gap-1" aria-hidden>
        {rows.map(({ match, i }) => (
          <span key={i} className="inline-flex flex-col items-stretch gap-1">
            <code className="rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[13px] break-all whitespace-pre-wrap text-fg">
              {visible ? match.token : mask(match.token)}
            </code>
            <span className={cn('h-1 rounded-full', MATCH_COLORS[i % MATCH_COLORS.length])} />
          </span>
        ))}
      </div>
      <div className="overflow-x-auto" role="region" aria-label="Matched patterns" tabIndex={0}>
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-[12px] text-fg-muted">
              <th className="py-2 pr-3 font-medium">Part</th>
              <th className="py-2 pr-3 font-medium">Pattern</th>
              <th className="py-2 pr-3 font-medium">Details</th>
              <th className="py-2 text-right font-medium">Guesses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ match, i, pattern, detail }) => (
              <tr key={i}>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span className={cn('size-2 shrink-0 rounded-full', MATCH_COLORS[i % MATCH_COLORS.length])} aria-hidden />
                    <code className="font-mono break-all text-fg">{visible ? match.token : mask(match.token)}</code>
                  </span>
                </td>
                <td className="py-2 pr-3 text-fg">{pattern}</td>
                <td className="py-2 pr-3 text-fg-secondary">
                  {visible && match.pattern === 'dictionary' && match.matchedWord && match.matchedWord !== match.token.toLowerCase()
                    ? `“${String(match.matchedWord)}”, ${detail}`
                    : detail}
                </td>
                <td className="py-2 text-right font-mono text-fg-secondary tabular-nums">
                  <Power10 log10={typeof match.guessesLog10 === 'number' ? match.guessesLog10 : Math.log10(Number(match.guesses) || 1)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
