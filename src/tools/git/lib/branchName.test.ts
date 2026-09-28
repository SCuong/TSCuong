import { describe, expect, it } from 'vitest';
import { generateBranchName, normalizeTicket, slugWords, toAscii, validateBranchName, type BranchOptions } from './branchName';

const base: BranchOptions = {
  title: '',
  ticket: '',
  prefix: 'feature',
  prefixSeparator: '/',
  wordSeparator: '-',
  lowercase: true,
  keepTicketCase: true,
  maxLength: 0,
  dropStopWords: false,
};

describe('toAscii', () => {
  it('strips Vietnamese and European diacritics', () => {
    expect(toAscii('Sửa lỗi đăng nhập trên điện thoại')).toBe('Sua loi dang nhap tren dien thoai');
    expect(toAscii('Đường phố Hà Nội')).toBe('Duong pho Ha Noi');
    expect(toAscii('Crème brûlée à la façon')).toBe('Creme brulee a la facon');
    expect(toAscii('Straße Øresund Łódź æble')).toBe('Strasse Oresund Lodz aeble');
  });
  it('leaves ASCII alone', () => {
    expect(toAscii('plain ASCII 123')).toBe('plain ASCII 123');
  });
});

describe('slugWords / normalizeTicket', () => {
  it('splits on punctuation and camelCase', () => {
    expect(slugWords("Fix user's loginPage crash (iOS)!")).toEqual(['Fix', 'users', 'login', 'Page', 'crash', 'iOS']);
  });
  it('keeps brand-style words such as iPhone together', () => {
    expect(slugWords('Crash on iPhone and eBay')).toEqual(['Crash', 'on', 'iPhone', 'and', 'eBay']);
  });
  it('drops stop words but never everything', () => {
    expect(slugWords('Add a link to the footer', true)).toEqual(['Add', 'link', 'footer']);
    expect(slugWords('the a', true)).toEqual(['the', 'a']);
  });
  it('removes emoji and symbols', () => {
    expect(slugWords('🚀 Launch 🎉 party')).toEqual(['Launch', 'party']);
  });
  it('normalizes tickets', () => {
    expect(normalizeTicket('#123')).toBe('123');
    expect(normalizeTicket(' PROJ-42 ')).toBe('PROJ-42');
    expect(normalizeTicket('abc 12')).toBe('abc-12');
    expect(normalizeTicket('')).toBe('');
  });
});

describe('generateBranchName', () => {
  it('combines prefix, ticket and title', () => {
    expect(generateBranchName({ ...base, title: 'Add dark mode toggle', ticket: 'LK-101' })).toBe('feature/LK-101-add-dark-mode-toggle');
  });
  it('lowercases the ticket when asked', () => {
    expect(generateBranchName({ ...base, title: 'x', ticket: 'LK-101', keepTicketCase: false })).toBe('feature/lk-101-x');
  });
  it('supports no prefix, other separators and case', () => {
    expect(generateBranchName({ ...base, prefix: '', title: 'Hello World' })).toBe('hello-world');
    expect(
      generateBranchName({ ...base, prefix: 'fix', prefixSeparator: '-', wordSeparator: '_', lowercase: false, title: 'Null Pointer' }),
    ).toBe('fix-Null_Pointer');
  });
  it('transliterates Vietnamese titles', () => {
    expect(generateBranchName({ ...base, prefix: 'fix', title: 'Sửa lỗi đăng nhập' })).toBe('fix/sua-loi-dang-nhap');
  });
  it('truncates on word boundaries', () => {
    const name = generateBranchName({ ...base, title: 'implement the new onboarding flow for enterprise customers', maxLength: 30 });
    expect(name.length).toBeLessThanOrEqual(30);
    expect(name).toBe('feature/implement-the-new');
  });
  it('hard-truncates a single long word and trims trailing separators', () => {
    const name = generateBranchName({ ...base, prefix: '', title: 'a'.repeat(50), maxLength: 10 });
    expect(name).toBe('aaaaaaaaaa');
    expect(generateBranchName({ ...base, prefix: '', title: 'abc def', maxLength: 4 })).toBe('abc');
  });
  it('returns just the prefix part when the title is empty', () => {
    expect(generateBranchName({ ...base, title: '', ticket: '' })).toBe('feature');
    expect(generateBranchName({ ...base, title: '', ticket: '42' })).toBe('feature/42');
  });
  it('never produces names ending in .lock', () => {
    const name = generateBranchName({ ...base, prefix: '', wordSeparator: '.', title: 'file lock' });
    expect(name).toBe('file');
    expect(validateBranchName(name)).toEqual([]);
  });
  it('always produces valid names for messy input', () => {
    for (const title of ['..weird~^:?*[\\ name..', '  ', '@{upstream}', '-dash start', '日本語のタイトル', '.hidden/.lock']) {
      const name = generateBranchName({ ...base, title });
      expect(validateBranchName(name), `${title} -> ${name}`).toEqual([]);
    }
  });
  it('handles very long input', () => {
    const name = generateBranchName({ ...base, title: 'word '.repeat(5000), maxLength: 60 });
    expect(name.length).toBeLessThanOrEqual(60);
  });
});

describe('validateBranchName (git check-ref-format rules)', () => {
  const ok = ['main', 'feature/login', 'fix/ABC-12_x', 'release/1.2.3', 'a/b/c', 'café', 'user@host', 'v1.0-rc'];
  it.each(ok)('accepts %s', (name) => expect(validateBranchName(name)).toEqual([]));

  const bad: Array<[string, RegExp]> = [
    ['', /empty/],
    ['@', /single character/],
    ['HEAD', /reserved/],
    ['-x', /start with “-”/],
    ['/x', /start or end with “\/”/],
    ['x/', /start or end with “\/”/],
    ['a//b', /consecutive slashes/],
    ['x.', /end with “\.”/],
    ['a..b', /“\.\.”/],
    ['a@{b', /“@\{”/],
    ['.x', /start with “\.”/],
    ['a/.x', /start with “\.”/],
    ['x.lock', /\.lock/],
    ['a.lock/b', /\.lock/],
    ['a b', /spaces/],
    ['a\tb', /control characters/],
    ['a~b', /“~”/],
    ['a^b', /“\^”/],
    ['a:b', /“:”/],
    ['a?b', /“\?”/],
    ['a*b', /“\*”/],
    ['a[b', /“\[”/],
    ['a\\b', /“\\”/],
  ];
  it.each(bad)('rejects %j', (name, pattern) => {
    const issues = validateBranchName(name);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => pattern.test(i.message))).toBe(true);
  });
  it('lists each forbidden character once', () => {
    const issues = validateBranchName('a~~b~');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('“~”');
    expect(issues[0].message.match(/~/g)).toHaveLength(1);
  });
});
