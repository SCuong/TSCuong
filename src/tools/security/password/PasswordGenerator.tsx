import { useEffect, useId, useMemo, useState } from 'react';
import { RectangleEllipsis, RefreshCw, RotateCcw, WholeWord } from 'lucide-react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Checkbox, Field, Input, Label, NumberInput } from '@/components/ui/Field';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Panel } from '@/components/ui/Panel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { useToolState } from '@/lib/hooks';
import { cn, errorMessage, formatNumber } from '@/lib/utils';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  DEFAULT_SYMBOLS,
  MAX_LENGTH,
  MAX_WORDS,
  MIN_LENGTH,
  MIN_WORDS,
  averageCrackTime,
  buildCharsets,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  passwordEntropyBits,
  rateEntropy,
  type Capitalization,
  type PassphraseOptions,
  type PasswordOptions,
} from './lib/generate';
import { SecureRandom } from './lib/random';
import { ColoredSecret, EntropyMeter } from './components';

const TOOL = 'password-generator';
type Mode = 'password' | 'passphrase';
const MAX_COUNT = 50;
/** Offline attack on a fast, unsalted hash with a GPU rig. */
const FAST_GUESSES_PER_SECOND = 1e10;

function clampInt(value: number | '', min: number, max: number, fallback: number): number {
  if (value === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default function PasswordGenerator() {
  const [mode, setMode] = useToolState<Mode>(TOOL, 'mode', 'password');
  const [count, setCount] = useToolState<number | ''>(TOOL, 'count', 5);
  const [pw, setPw] = useToolState<PasswordOptions>(TOOL, 'password', DEFAULT_PASSWORD_OPTIONS);
  const [pp, setPp] = useToolState<PassphraseOptions>(TOOL, 'passphrase', DEFAULT_PASSPHRASE_OPTIONS);
  const [nonce, setNonce] = useState(0);
  const [words, setWords] = useState<readonly string[] | null>(null);
  const [wordsError, setWordsError] = useState<string | null>(null);
  const countId = useId();

  // Stored options from older versions may miss fields: merge over the defaults.
  const pwOptions = useMemo(() => ({ ...DEFAULT_PASSWORD_OPTIONS, ...pw }), [pw]);
  const ppOptions = useMemo(() => ({ ...DEFAULT_PASSPHRASE_OPTIONS, ...pp }), [pp]);
  const n = clampInt(count, 1, MAX_COUNT, 5);

  useEffect(() => {
    if (mode !== 'passphrase' || words) return;
    let cancelled = false;
    import('./lib/effShortWords')
      .then((m) => !cancelled && setWords(m.EFF_SHORT_WORDS))
      .catch((e) => !cancelled && setWordsError(errorMessage(e, 'The word list could not be loaded.')));
    return () => {
      cancelled = true;
    };
  }, [mode, words]);

  const charsets = useMemo(() => buildCharsets(pwOptions), [pwOptions]);

  const generated = useMemo(() => {
    void nonce;
    const rng = new SecureRandom();
    if (mode === 'password') {
      if (!charsets.ok) return null;
      return {
        items: Array.from({ length: n }, () => generatePassword(charsets, pwOptions.length, pwOptions.requireEach, rng)),
        bits: passwordEntropyBits(
          charsets.sets.map((s) => s.chars.length),
          pwOptions.length,
          pwOptions.requireEach,
        ),
      };
    }
    if (!words) return null;
    return {
      items: Array.from({ length: n }, () => generatePassphrase(words, ppOptions, rng)),
      bits: passphraseEntropyBits(words.length, ppOptions),
    };
  }, [mode, charsets, pwOptions, ppOptions, words, n, nonce]);

  const updatePw = (patch: Partial<PasswordOptions>) => setPw({ ...pwOptions, ...patch });
  const updatePp = (patch: Partial<PassphraseOptions>) => setPp({ ...ppOptions, ...patch });
  const rating = generated ? rateEntropy(generated.bits) : null;
  const error = mode === 'password' && !charsets.ok ? charsets.error : mode === 'passphrase' ? wordsError : null;

  return (
    <ToolStack>
      <ToolBar>
        <div className="max-w-full">
          <Label>Generate</Label>
          <Segmented
            label="What to generate"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'password', label: 'Password', icon: RectangleEllipsis },
              { value: 'passphrase', label: 'Passphrase', icon: WholeWord },
            ]}
          />
        </div>
        <div className="w-28">
          <Label htmlFor={countId}>How many</Label>
          <NumberInput id={countId} value={count} onChange={setCount} min={1} max={MAX_COUNT} />
        </div>
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} disabled={!generated} className="sm:ml-auto">
          Generate new
        </Button>
      </ToolBar>

      <SplitPanes className="lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title={mode === 'password' ? 'Password options' : 'Passphrase options'} bodyClassName="flex flex-col gap-5">
          {mode === 'password' ? (
            <PasswordOptionsForm options={pwOptions} onChange={updatePw} alphabetSize={charsets.ok ? charsets.alphabet.length : 0} />
          ) : (
            <PassphraseOptionsForm options={ppOptions} onChange={updatePp} />
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <ErrorMessage error={error} />
          {!generated && !error && (
            <Panel>
              <div className="flex justify-center py-10">
                <Spinner label="Preparing the word list…" />
              </div>
            </Panel>
          )}
          {generated && rating && (
            <Panel
              title={`${generated.items.length} ${mode === 'password' ? 'password' : 'passphrase'}${generated.items.length === 1 ? '' : 's'}`}
              actions={
                <>
                  <CopyButton value={generated.items.join('\n')} label="Copy all" />
                  <DownloadButton data={generated.items.join('\n')} filename={mode === 'password' ? 'passwords.txt' : 'passphrases.txt'} />
                </>
              }
              bodyClassName="p-0"
            >
              <div className="border-b border-line px-4 py-3">
                <EntropyMeter bits={generated.bits} rating={rating} />
                <p className="mt-2 text-[12.5px] text-fg-muted">
                  Average time to guess at {formatNumber(FAST_GUESSES_PER_SECOND / 1e9, 0)} billion guesses per second (an
                  offline attack on a fast hash): <span className="text-fg-secondary">{averageCrackTime(generated.bits, FAST_GUESSES_PER_SECOND)}</span>.
                  Entropy comes from the settings, so every item below has the same.
                </p>
              </div>
              <ol className="divide-y divide-line">
                {generated.items.map((item, i) => (
                  <li key={`${nonce}-${i}`} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-5 shrink-0 text-right text-[12px] text-fg-muted tabular-nums">{i + 1}</span>
                    <ColoredSecret
                      value={item}
                      className={cn('min-w-0 flex-1 font-mono [overflow-wrap:anywhere]', mode === 'password' ? 'text-[14px]' : 'text-[14.5px]')}
                    />
                    <Badge tone={rating.tone} className="shrink-0">
                      {Math.round(generated.bits)} bits
                    </Badge>
                    <CopyButton value={item} iconOnly label={`Copy ${mode} ${i + 1}`} />
                  </li>
                ))}
              </ol>
              <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-fg-muted">
                Generated in your browser with <code className="font-mono">crypto.getRandomValues</code> and rejection
                sampling (no modulo bias). Nothing is sent or saved.
              </p>
            </Panel>
          )}
        </div>
      </SplitPanes>
    </ToolStack>
  );
}

function PasswordOptionsForm({
  options,
  onChange,
  alphabetSize,
}: {
  options: PasswordOptions;
  onChange: (patch: Partial<PasswordOptions>) => void;
  alphabetSize: number;
}) {
  const lengthId = useId();
  const symbolsId = useId();
  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <Label htmlFor={lengthId} className="mb-0">
            Length
          </Label>
          <NumberInput
            aria-label="Length (number)"
            value={options.length}
            onChange={(v) => onChange({ length: clampInt(v, MIN_LENGTH, MAX_LENGTH, options.length) })}
            min={MIN_LENGTH}
            max={MAX_LENGTH}
            className="h-8 w-20"
          />
        </div>
        <input
          id={lengthId}
          type="range"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          value={options.length}
          onChange={(e) => onChange({ length: Number(e.target.value) })}
          className="w-full accent-[var(--lk-accent)]"
        />
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-[13px] font-medium text-fg-secondary">Characters</legend>
        <Checkbox label="Uppercase (A–Z)" checked={options.upper} onChange={(upper) => onChange({ upper })} />
        <Checkbox label="Lowercase (a–z)" checked={options.lower} onChange={(lower) => onChange({ lower })} />
        <Checkbox label="Digits (0–9)" checked={options.digits} onChange={(digits) => onChange({ digits })} />
        <Checkbox label="Symbols" checked={options.symbols} onChange={(symbols) => onChange({ symbols })} />
        {options.symbols && (
          <Field className="pl-6.5" hint="Duplicates, spaces and characters already in another set are ignored.">
            {({ describedBy }) => (
              <div className="flex gap-2">
                <Input
                  id={symbolsId}
                  aria-label="Symbols to use"
                  aria-describedby={describedBy}
                  mono
                  value={options.symbolSet}
                  onChange={(e) => onChange({ symbolSet: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
                <IconButton
                  icon={RotateCcw}
                  label="Reset symbols to the default set"
                  disabled={options.symbolSet === DEFAULT_SYMBOLS}
                  onClick={() => onChange({ symbolSet: DEFAULT_SYMBOLS })}
                />
              </div>
            )}
          </Field>
        )}
      </fieldset>

      <div className="flex flex-col gap-3">
        <Checkbox
          label="Exclude look-alikes"
          description="Skip I l 1 | O 0 o, which are easy to misread."
          checked={options.excludeLookalikes}
          onChange={(excludeLookalikes) => onChange({ excludeLookalikes })}
        />
        <Checkbox
          label="Use every selected set"
          description="Candidates missing a set are thrown away, so results stay uniformly random."
          checked={options.requireEach}
          onChange={(requireEach) => onChange({ requireEach })}
        />
      </div>
      {alphabetSize > 0 && (
        <p className="text-[12.5px] text-fg-muted">
          Alphabet of {alphabetSize} characters × {options.length} positions.
        </p>
      )}
    </>
  );
}

const SEPARATORS: Array<{ value: string; label: string; title: string }> = [
  { value: '-', label: '-', title: 'Hyphen' },
  { value: ' ', label: 'Space', title: 'Space' },
  { value: '.', label: '.', title: 'Period' },
  { value: '_', label: '_', title: 'Underscore' },
  { value: ',', label: ',', title: 'Comma' },
  { value: '', label: 'None', title: 'No separator' },
];

function PassphraseOptionsForm({ options, onChange }: { options: PassphraseOptions; onChange: (patch: Partial<PassphraseOptions>) => void }) {
  const wordsId = useId();
  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <Label htmlFor={wordsId} className="mb-0">
            Words
          </Label>
          <NumberInput
            aria-label="Number of words"
            value={options.words}
            onChange={(v) => onChange({ words: clampInt(v, MIN_WORDS, MAX_WORDS, options.words) })}
            min={MIN_WORDS}
            max={MAX_WORDS}
            className="h-8 w-20"
          />
        </div>
        <input
          id={wordsId}
          type="range"
          min={MIN_WORDS}
          max={MAX_WORDS}
          value={options.words}
          onChange={(e) => onChange({ words: Number(e.target.value) })}
          className="w-full accent-[var(--lk-accent)]"
        />
      </div>
      <div className="max-w-full">
        <Label>Separator</Label>
        <Segmented
          label="Separator"
          value={SEPARATORS.some((s) => s.value === options.separator) ? options.separator : '-'}
          onChange={(separator) => onChange({ separator })}
          options={SEPARATORS}
        />
      </div>
      <div className="max-w-full">
        <Label>Capitalization</Label>
        <Segmented<Capitalization>
          label="Capitalization"
          value={options.capitalization}
          onChange={(capitalization) => onChange({ capitalization })}
          options={[
            { value: 'lower', label: 'lower' },
            { value: 'capitalize', label: 'Title' },
            { value: 'upper', label: 'UPPER' },
            { value: 'random', label: 'Random', title: 'Each word is randomly capitalized (+1 bit per word)' },
          ]}
        />
      </div>
      <Checkbox
        label="Add a number"
        description="A random number from 0 to 99 at a random position, for sites that insist on a digit."
        checked={options.includeNumber}
        onChange={(includeNumber) => onChange({ includeNumber })}
      />
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        Words come from the{' '}
        <a href="https://www.eff.org/dice" target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">
          EFF short word list
        </a>{' '}
        (1,296 short, memorable words, about 10.3 bits each) by the Electronic Frontier Foundation, used under{' '}
        <a
          href="https://creativecommons.org/licenses/by/3.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-text underline underline-offset-2"
        >
          CC BY 3.0
        </a>
        .
      </p>
    </>
  );
}
