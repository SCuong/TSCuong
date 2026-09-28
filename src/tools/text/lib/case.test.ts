import { describe, expect, it } from 'vitest';
import {
  alternatingCase,
  camelCase,
  capitalizedCase,
  constantCase,
  dotCase,
  inverseCase,
  kebabCase,
  pascalCase,
  pathCase,
  sentenceCase,
  snakeCase,
  splitWords,
  titleCase,
  CASE_VARIANTS,
} from './case';

describe('splitWords', () => {
  it('splits separators, camelCase and acronyms', () => {
    expect(splitWords('hello_world-foo.bar/baz qux')).toEqual(['hello', 'world', 'foo', 'bar', 'baz', 'qux']);
    expect(splitWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    expect(splitWords('getHTTPResponseCode')).toEqual(['get', 'HTTP', 'Response', 'Code']);
    expect(splitWords('version2Beta')).toEqual(['version2', 'Beta']);
    expect(splitWords('')).toEqual([]);
    expect(splitWords('  --  ')).toEqual([]);
  });

  it('handles Unicode letters', () => {
    expect(splitWords('ÉtéChaud')).toEqual(['Été', 'Chaud']);
    expect(splitWords('привет мир')).toEqual(['привет', 'мир']);
  });
});

describe('programming cases', () => {
  const input = 'Hello world, how ARE you?';
  it('converts', () => {
    expect(camelCase(input)).toBe('helloWorldHowAreYou');
    expect(pascalCase(input)).toBe('HelloWorldHowAreYou');
    expect(snakeCase(input)).toBe('hello_world_how_are_you');
    expect(constantCase(input)).toBe('HELLO_WORLD_HOW_ARE_YOU');
    expect(kebabCase(input)).toBe('hello-world-how-are-you');
    expect(dotCase(input)).toBe('hello.world.how.are.you');
    expect(pathCase(input)).toBe('hello/world/how/are/you');
  });

  it('round-trips between identifier styles', () => {
    expect(camelCase('user_account_id')).toBe('userAccountId');
    expect(snakeCase('userAccountID')).toBe('user_account_id');
    expect(kebabCase('XMLHttpRequest')).toBe('xml-http-request');
  });

  it('converts each line separately', () => {
    expect(snakeCase('First line\nSecond line\n')).toBe('first_line\nsecond_line\n');
  });

  it('works with accented words', () => {
    expect(camelCase('crème brûlée')).toBe('crèmeBrûlée');
  });
});

describe('prose cases', () => {
  it('title case keeps small words lowercase in the middle', () => {
    expect(titleCase('the lord of the rings')).toBe('The Lord of the Rings');
    expect(titleCase('a tale of two cities: the end')).toBe('A Tale of Two Cities: The End');
    expect(titleCase("what's up with you?")).toBe("What's Up with You?");
  });

  it('capitalized words capitalizes every word', () => {
    expect(capitalizedCase('the lord of the rings')).toBe('The Lord Of The Rings');
  });

  it('sentence case', () => {
    expect(sentenceCase('HELLO THERE. how are you? i am FINE!')).toBe('Hello there. How are you? I am fine!');
    expect(sentenceCase('"quoted start" here')).toBe('"Quoted start" here');
    expect(sentenceCase('line one\nline two')).toBe('Line one\nLine two');
  });

  it('alternating and inverse', () => {
    expect(alternatingCase('hello world')).toBe('hElLo WoRlD');
    expect(inverseCase('Hello World 123')).toBe('hELLO wORLD 123');
    expect(inverseCase('Ärger')).toBe('äRGER');
  });

  it('keeps emoji intact', () => {
    expect(inverseCase('hi 👋🏽')).toBe('HI 👋🏽');
    expect(alternatingCase('ab👍cd')).toBe('aB👍cD');
  });
});

describe('CASE_VARIANTS', () => {
  it('every variant returns empty for empty input', () => {
    for (const v of CASE_VARIANTS) expect(v.convert('')).toBe('');
  });

  it('has unique ids', () => {
    expect(new Set(CASE_VARIANTS.map((v) => v.id)).size).toBe(CASE_VARIANTS.length);
  });

  it('handles long input', () => {
    const long = 'word '.repeat(20000);
    expect(camelCase(long).length).toBe(4 * 20000);
  });
});

describe('title case with capitals', () => {
  it('keeps words with inner capitals and handles all-caps lines', () => {
    expect(titleCase('using XMLHttpRequest on my iPhone')).toBe('Using XMLHttpRequest on My iPhone');
    expect(titleCase('HELLO WORLD OF CODE')).toBe('Hello World of Code');
    expect(capitalizedCase('the NASA mission')).toBe('The NASA Mission');
  });
});
