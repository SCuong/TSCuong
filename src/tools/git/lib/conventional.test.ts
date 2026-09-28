import { describe, expect, it } from 'vitest';
import { buildCommitMessage, lintCommitMessage, parseIssueRefs, wrapText, type CommitInput } from './conventional';

const empty: CommitInput = {
  type: 'feat',
  scope: '',
  breaking: false,
  subject: '',
  body: '',
  breakingDescription: '',
  closes: '',
  footers: [],
  wrap: 72,
};

describe('buildCommitMessage', () => {
  it('builds a header only', () => {
    expect(buildCommitMessage({ ...empty, subject: 'add login' })).toBe('feat: add login');
  });
  it('adds scope, breaking marker, body and footers', () => {
    const msg = buildCommitMessage({
      ...empty,
      type: 'fix',
      scope: 'api',
      breaking: true,
      subject: '  drop   v1 endpoints ',
      body: 'The v1 endpoints were deprecated a year ago.\n',
      breakingDescription: 'the /v1 routes are gone',
      closes: '#12, 15 PROJ-7',
      footers: [
        { token: 'Reviewed by', value: 'Ada' },
        { token: 'Refs', value: '#99' },
        { token: '', value: 'ignored' },
      ],
    });
    expect(msg).toBe(
      [
        'fix(api)!: drop v1 endpoints',
        '',
        'The v1 endpoints were deprecated a year ago.',
        '',
        'BREAKING CHANGE: the /v1 routes are gone',
        'Closes #12',
        'Closes #15',
        'Closes PROJ-7',
        'Reviewed-by: Ada',
        'Refs #99',
      ].join('\n'),
    );
    expect(lintCommitMessage(msg).valid).toBe(true);
  });
  it('wraps long body text', () => {
    const msg = buildCommitMessage({ ...empty, subject: 'x', body: 'word '.repeat(40).trim(), wrap: 20 });
    const bodyLines = msg.split('\n').slice(2);
    expect(bodyLines.every((l) => l.length <= 20)).toBe(true);
    expect(bodyLines.join(' ')).toBe('word '.repeat(40).trim());
  });
  it('keeps unicode and emoji', () => {
    expect(buildCommitMessage({ ...empty, subject: 'thêm biểu tượng 🚀' })).toBe('feat: thêm biểu tượng 🚀');
  });
});

describe('wrapText', () => {
  it('keeps short lines, code and list indentation', () => {
    expect(wrapText('short', 10)).toBe('short');
    expect(wrapText('    const x = 1; // a very long code line', 10)).toBe('    const x = 1; // a very long code line');
    expect(wrapText('- one two three four', 10)).toBe('- one two\n  three\n  four');
    expect(wrapText('anything', 0)).toBe('anything');
  });
  it('does not split a single long word', () => {
    expect(wrapText('https://example.com/a/very/long/url', 10)).toBe('https://example.com/a/very/long/url');
  });
});

describe('parseIssueRefs', () => {
  it('splits on commas and spaces', () => {
    expect(parseIssueRefs('#1, #2  PROJ-3;4')).toEqual(['#1', '#2', 'PROJ-3', '4']);
    expect(parseIssueRefs('')).toEqual([]);
  });
});

describe('lintCommitMessage', () => {
  const errors = (msg: string) => lintCommitMessage(msg).issues.filter((i) => i.severity === 'error').map((i) => i.message);
  const warnings = (msg: string) => lintCommitMessage(msg).issues.filter((i) => i.severity === 'warning').map((i) => i.message);

  it('accepts valid messages', () => {
    for (const msg of [
      'feat: add array support',
      'fix(parser): handle empty input',
      'feat(api)!: remove v1',
      'docs: fix typo\n\nLonger body here.\n\nRefs: #12',
      'chore!: drop node 16\n\nBREAKING CHANGE: node 18 is required',
    ]) {
      const r = lintCommitMessage(msg);
      expect(r.valid, msg).toBe(true);
      expect(r.issues.filter((i) => i.severity !== 'info'), msg).toEqual([]);
    }
  });

  it('returns nothing for empty input', () => {
    const r = lintCommitMessage('  \n\n');
    expect(r.issues).toEqual([]);
    expect(r.valid).toBe(false);
    expect(r.header).toBeNull();
  });

  it('rejects headers without the type prefix', () => {
    expect(errors('add stuff')[0]).toMatch(/type\(scope\): description/);
    expect(errors('feat add stuff')[0]).toMatch(/type\(scope\): description/);
  });

  it('checks colon spacing, empty scope and missing description', () => {
    expect(errors('feat:add')).toContain('Put a single space after the colon.');
    expect(errors('feat(): add')[0]).toMatch(/scope in parentheses is empty/);
    expect(errors('feat: ')).toContain('The description after the colon is missing.');
    expect(errors('feat:')).toEqual(expect.arrayContaining(['The description after the colon is missing.']));
  });

  it('parses the header parts', () => {
    expect(lintCommitMessage('feat(ui-kit)!: add button').header).toEqual({
      type: 'feat',
      scope: 'ui-kit',
      breaking: true,
      description: 'add button',
    });
  });

  it('warns about unknown or uppercase types and allows extra types', () => {
    expect(warnings('feature: add x')[0]).toMatch(/not a standard type/);
    expect(warnings('Feat: add x')[0]).toMatch(/lowercase/);
    const r = lintCommitMessage('wip: add x', { maxHeaderLength: 72, maxBodyLineLength: 100, extraTypes: ['wip'] });
    expect(r.issues.filter((i) => i.severity === 'warning')).toEqual([]);
  });

  it('gives style hints: period, capital letter, imperative mood, length', () => {
    expect(warnings('fix: add thing.')).toContain('Do not end the description with a period.');
    expect(warnings('fix: Add thing').some((w) => /lowercase letter/.test(w))).toBe(true);
    expect(warnings('fix: added thing')[0]).toMatch(/“add” instead of “added”/);
    expect(warnings('fix: fixes crash')[0]).toMatch(/“fix” instead of “fixes”/);
    expect(warnings(`feat: ${'x'.repeat(80)}`).some((w) => /at most 72/.test(w))).toBe(true);
  });

  it('requires a blank line before the body', () => {
    expect(errors('feat: add x\nbody right away')).toContain('Leave a blank line between the first line and the body.');
  });

  it('warns about long body lines but not URLs', () => {
    expect(warnings(`feat: add x\n\n${'y'.repeat(120)}`)[0]).toMatch(/Body line is 120 characters/);
    expect(warnings(`feat: add x\n\nsee https://example.com/${'y'.repeat(120)}`)).toEqual([]);
  });

  it('recognises footers and breaking changes', () => {
    const r = lintCommitMessage('feat: add x\n\nbody\n\nBREAKING CHANGE: config moved\nReviewed-by: Z\nRefs #3');
    expect(r.breaking).toBe(true);
    expect(r.footers).toEqual([
      { token: 'BREAKING CHANGE', value: 'config moved' },
      { token: 'Reviewed-by', value: 'Z' },
      { token: 'Refs', value: '3' },
    ]);
    expect(r.issues.some((i) => /add “!”/.test(i.message))).toBe(true);
    expect(r.valid).toBe(true);
  });

  it('accepts BREAKING-CHANGE as a synonym and multi-line footer values', () => {
    const r = lintCommitMessage('feat!: x\n\nBREAKING-CHANGE: first line\n  continues here');
    expect(r.footers[0]).toEqual({ token: 'BREAKING-CHANGE', value: 'first line\n  continues here' });
    expect(r.valid).toBe(true);
  });

  it('rejects lowercase breaking change and footer tokens with spaces', () => {
    expect(errors('feat: x\n\nbreaking change: oops')).toContain('“BREAKING CHANGE” must be written in uppercase.');
    expect(errors('feat: x\n\nRefs: 1\nReviewed by: Ada')[0]).toMatch(/Reviewed-by/);
  });

  it('lints the footer section even when it starts with a lowercase breaking change', () => {
    const nl = String.fromCharCode(10);
    const errs = errors(['feat: x', '', 'body', '', 'breaking change: oops', 'Reviewed by: Ada'].join(nl));
    expect(errs).toEqual(['“BREAKING CHANGE” must be written in uppercase.', expect.stringMatching(/Reviewed-by/)]);
    expect(errors(['feat: x', '', 'breaking-change: oops'].join(nl))).toContain('“BREAKING CHANGE” must be written in uppercase.');
  });

  it('flags a BREAKING CHANGE that is not in the footer section', () => {
    expect(errors('feat: x\n\nBREAKING CHANGE: a\n\nmore body text')[0]).toMatch(/last paragraph/);
  });

  it('ignores comment lines and the scissors section', () => {
    const msg = 'feat: add x\n# Please enter the commit message\n\n# ------------------------ >8 ------------------------\ndiff --git a b';
    const r = lintCommitMessage(msg);
    expect(r.valid).toBe(true);
  });

  it('treats merge and revert messages as exempt', () => {
    expect(lintCommitMessage("Merge branch 'main' into dev").exempt).toBe('merge commit');
    expect(lintCommitMessage('Revert "feat: x"\n\nThis reverts commit abc.').exempt).toBe('git revert message');
    expect(lintCommitMessage('fixup! feat: x').valid).toBe(true);
  });

  it('handles CRLF and unicode', () => {
    const r = lintCommitMessage('fix(ký-tự): sửa lỗi 🐛\r\n\r\nNội dung.\r\n');
    expect(r.valid).toBe(true);
    expect(r.header?.scope).toBe('ký-tự');
  });

  it('reports line numbers', () => {
    const r = lintCommitMessage(`feat: add x\n\nok\n${'z'.repeat(130)}`);
    expect(r.issues[0].line).toBe(4);
  });

  it('handles very long input', () => {
    const r = lintCommitMessage(`feat: add x\n\n${'word '.repeat(20000)}`);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});
