import { describe, expect, it, vi } from 'vitest';
import { compileRegex, describeRegexError } from './errors';
import { isFlagSupported, matchingFlags, normalizeFlags, toggleFlag } from './flags';
import { toRegExpConstructor, toRegexLiteral } from './literal';
import { RegexRunner } from './runner';
import { runRegexJob } from './job';

function engineError(pattern: string, flags = ''): unknown {
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    return error;
  }
  throw new Error(`/${pattern}/${flags} unexpectedly compiled`);
}

describe('describeRegexError', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['(', '', /never closed.*"\("/],
    [')', '', /without a matching "\("/],
    ['[', '', /character class is never closed/],
    ['*', '', /nothing to repeat/],
    ['a{2,1}', '', /minimum is larger/],
    ['\\', '', /lone backslash/],
    ['(?<n>a)(?<n>b)', '', /same name/],
    ['\\k<x>', 'u', /group name that does not exist/],
    ['[z-a]', '', /backwards/],
    ['(?<1a>x)', '', /group name is not valid/],
    ['\\p{Foo}', 'u', /Unknown Unicode property/],
    ['\\u{110000}', 'u', /Unicode escape/],
    ['\\-', 'u', /escape sequence is not valid in u\/v mode/],
    ['{', 'u', /must be escaped/],
    ['a{1', 'u', /not complete/],
    ['(?=a)*', 'u', /cannot be repeated/],
    ['(?z:a)', '', /Unknown group syntax/],
    ['[(]', 'v', /not valid in v mode/],
    ['[\\d-z]', 'u', /cannot be one end of a range/],
  ];
  for (const [pattern, flags, expected] of cases) {
    it(`explains /${pattern}/${flags}`, () => {
      expect(describeRegexError(engineError(pattern, flags), flags)).toMatch(expected);
    });
  }

  it('explains bad flags', () => {
    expect(describeRegexError(engineError('a', 'gg'), 'gg')).toMatch(/Each flag may appear once/);
    expect(describeRegexError(engineError('a', 'uv'), 'uv')).toMatch(/u and v flags cannot be used together/);
  });

  it('maps Firefox and Safari wordings', () => {
    expect(describeRegexError(new SyntaxError('unterminated parenthetical'))).toMatch(/never closed/);
    expect(describeRegexError(new SyntaxError('missing terminating ] for character class'))).toMatch(/class is never closed/);
    expect(describeRegexError(new SyntaxError('invalid regular expression flag x'))).toMatch(/flags are not valid/);
  });

  it('cleans unknown messages into a sentence', () => {
    expect(describeRegexError(new SyntaxError('Invalid regular expression: /x/: something odd'))).toBe('Something odd.');
    expect(describeRegexError('')).toBe('The pattern is not a valid regular expression.');
  });
});

describe('compileRegex', () => {
  it('compiles valid patterns and reports invalid ones', () => {
    const ok = compileRegex('a+', 'gi');
    expect(ok.ok && ok.regex.flags).toBe('gi');
    expect(compileRegex('(', '')).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe('flags', () => {
  it('normalizes order and duplicates', () => {
    expect(normalizeFlags('yigxg')).toBe('giy');
    expect(normalizeFlags('')).toBe('');
  });

  it('toggles flags and keeps u and v exclusive', () => {
    expect(toggleFlag('g', 'i')).toBe('gi');
    expect(toggleFlag('gi', 'g')).toBe('i');
    expect(toggleFlag('gu', 'v')).toBe('gv');
    expect(toggleFlag('gv', 'u')).toBe('gu');
  });

  it('adds d for matching', () => {
    expect(matchingFlags('gi')).toBe('dgi');
    expect(matchingFlags('dg')).toBe('dg');
  });

  it('detects supported flags', () => {
    expect(isFlagSupported('g')).toBe(true);
    expect(isFlagSupported('v')).toBe(true); // Node 20+
    expect(isFlagSupported('x')).toBe(false);
  });
});

describe('literal', () => {
  it('prints a regex literal with slashes and line breaks escaped', () => {
    expect(toRegexLiteral('a/b', 'g')).toBe('/a\\/b/g');
    expect(toRegexLiteral('', '')).toBe('/(?:)/');
    expect(toRegexLiteral('\n', '')).toBe('/\\n/');
  });

  it('prints a RegExp constructor call that round-trips', () => {
    const pattern = '"(\\d+)"\\s*' + String.fromCharCode(0x2028) + '😀';
    const code = toRegExpConstructor(pattern, 'gu');
    expect(code.startsWith('new RegExp("')).toBe(true);
    const [, src, flags] = /^new RegExp\((".*"), (".*")\)$/.exec(code)!;
    expect(JSON.parse(src)).toBe(pattern);
    expect(JSON.parse(flags)).toBe('gu');
    expect(toRegExpConstructor('a', '')).toBe('new RegExp("a")');
  });
});

/** Minimal Worker stand-in that runs jobs synchronously (or never, to simulate a hang). */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly hang: boolean) {}
  postMessage(data: { id: number } & Parameters<typeof runRegexJob>[0]) {
    if (this.hang) return;
    const { id, ...job } = data;
    queueMicrotask(() => this.onmessage?.({ data: { id, result: runRegexJob(job) } } as MessageEvent));
  }
  terminate() {
    this.terminated = true;
  }
}

describe('RegexRunner', () => {
  const job = { pattern: 'a', flags: 'g', text: 'aa', replacement: null };

  it('resolves with the worker result', async () => {
    const runner = new RegexRunner(() => new FakeWorker(false) as unknown as Worker);
    const outcome = await runner.run(job, 1000);
    expect(outcome.status).toBe('done');
    expect(outcome.status === 'done' && outcome.result.ok && outcome.result.summary.total).toBe(2);
    runner.dispose();
  });

  it('times out, terminates the worker and uses a fresh one next time', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    let hang = true;
    const runner = new RegexRunner(() => {
      const w = new FakeWorker(hang);
      workers.push(w);
      return w as unknown as Worker;
    });
    const pending = runner.run(job, 500);
    vi.advanceTimersByTime(600);
    expect(await pending).toEqual({ status: 'timeout' });
    expect(workers[0].terminated).toBe(true);
    hang = false;
    vi.useRealTimers();
    const next = await runner.run(job, 500);
    expect(next.status).toBe('done');
    expect(workers).toHaveLength(2);
    runner.dispose();
  });

  it('supersedes a running job', async () => {
    const runner = new RegexRunner(() => new FakeWorker(true) as unknown as Worker);
    const first = runner.run(job, 10_000);
    void runner.run(job, 10_000);
    expect(await first).toEqual({ status: 'superseded' });
    runner.dispose();
  });
});
