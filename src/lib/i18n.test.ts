import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setMessagesForTests, t } from './i18n';

afterEach(() => setMessagesForTests('en', null));

describe('t', () => {
  it('returns the English text when no dictionary is loaded', () => {
    expect(t('Open file')).toBe('Open file');
    expect(getLocale()).toBe('en');
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(t('{count} of {total} done', { count: 3, total: 10 })).toBe('3 of 10 done');
    expect(t('Hello {name}, {missing}', { name: 'Ana' })).toBe('Hello Ana, {missing}');
  });

  it('does not treat text in braces as a placeholder without params', () => {
    expect(t('Use {name} here')).toBe('Use {name} here');
  });

  it('translates with the loaded dictionary and falls back to English', () => {
    setMessagesForTests('vi', { 'Open file': 'Mở tệp', '{count} files': '{count} tệp' });
    expect(getLocale()).toBe('vi');
    expect(t('Open file')).toBe('Mở tệp');
    expect(t('{count} files', { count: 2 })).toBe('2 tệp');
    expect(t('Not translated')).toBe('Not translated');
  });

  it('never returns inherited object members', () => {
    setMessagesForTests('vi', {});
    expect(t('constructor')).toBe('constructor');
    expect(t('toString')).toBe('toString');
    expect(t('Say {constructor}', { name: 'x' })).toBe('Say {constructor}');
  });
});
