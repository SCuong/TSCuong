import { describe, expect, it } from 'vitest';
import { slugify, slugifyLines, transliterate } from './slug';

describe('transliterate', () => {
  it('strips accents and maps special letters', () => {
    expect(transliterate('Crème Brûlée à la carte')).toBe('Creme Brulee a la carte');
    expect(transliterate('Straße Øresund Łódź æther')).toBe('Strasse Oresund Lodz aether');
    expect(transliterate('Привет мир')).toBe('Privet mir');
    expect(transliterate('Αθήνα')).toBe('Athina');
  });

  it('optionally spells out German umlauts', () => {
    expect(transliterate('Müller', { germanUmlauts: true })).toBe('Mueller');
    expect(transliterate('Müller')).toBe('Muller');
  });
});

describe('slugify', () => {
  it('creates clean slugs', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  Multiple   spaces -- and --- dashes  ')).toBe('multiple-spaces-and-dashes');
    expect(slugify("Don't stop me now")).toBe('dont-stop-me-now');
    expect(slugify('Tom & Jerry')).toBe('tom-and-jerry');
    expect(slugify('Tom & Jerry', { symbols: false })).toBe('tom-jerry');
  });

  it('supports custom separators and case', () => {
    expect(slugify('Hello World', { separator: '_' })).toBe('hello_world');
    expect(slugify('Hello World', { separator: '', lowercase: false })).toBe('HelloWorld');
    expect(slugify('Hello World', { lowercase: false })).toBe('Hello-World');
  });

  it('truncates at word boundaries', () => {
    expect(slugify('The quick brown fox jumps', { maxLength: 12 })).toBe('the-quick');
    expect(slugify('The quick brown fox', { maxLength: 9 })).toBe('the-quick');
    expect(slugify('Supercalifragilistic', { maxLength: 5 })).toBe('super');
    expect(slugify('ab cd', { maxLength: 3 })).toBe('ab');
  });

  it('drops or keeps non-Latin letters', () => {
    expect(slugify('日本語 title')).toBe('title');
    expect(slugify('日本語 title', { keepUnicode: true })).toBe('日本語-title');
    expect(slugify('😀🎉')).toBe('');
  });

  it('bulk mode keeps empty lines', () => {
    expect(slugifyLines('First Post\n\nSecond Post')).toBe('first-post\n\nsecond-post');
  });
});
