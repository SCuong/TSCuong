import { describe, expect, it } from 'vitest';
import {
  camelCase,
  commonSuffix,
  GO_INITIALISMS,
  isAsciiIdentifier,
  itemWords,
  Namer,
  pascalCase,
  singularize,
  snakeCase,
  splitWords,
} from './naming';

describe('splitWords', () => {
  it.each([
    ['userName', ['user', 'Name']],
    ['user_name', ['user', 'name']],
    ['first-name', ['first', 'name']],
    ['UserID', ['User', 'ID']],
    ['userIDs', ['user', 'IDs']],
    ['HTMLParser', ['HTML', 'Parser']],
    ['getHTTPResponseCode', ['get', 'HTTP', 'Response', 'Code']],
    ['address2', ['address2']],
    ['line1Text', ['line1', 'Text']],
    ['X509Cert', ['X509', 'Cert']],
    ['USER_NAME', ['USER', 'NAME']],
    ['2fa', ['2fa']],
    ['a.b c', ['a', 'b', 'c']],
    ['', []],
    ['$ref', ['ref']],
    ['名前', []],
    ['café au lait', ['caf', 'au', 'lait']],
    ['🚀 launch', ['launch']],
  ])('%s', (input, words) => {
    expect(splitWords(input)).toEqual(words);
  });
});

describe('case conversion', () => {
  it('converts words to Pascal, camel and snake case', () => {
    const words = splitWords('userIDs_count');
    expect(pascalCase(words)).toBe('UserIdsCount');
    expect(camelCase(words)).toBe('userIdsCount');
    expect(snakeCase(words)).toBe('user_ids_count');
  });

  it('keeps Go initialisms upper case, including plurals', () => {
    expect(pascalCase(splitWords('userId'), GO_INITIALISMS)).toBe('UserID');
    expect(pascalCase(splitWords('avatar_url'), GO_INITIALISMS)).toBe('AvatarURL');
    expect(pascalCase(splitWords('apiKeys'), GO_INITIALISMS)).toBe('APIKeys');
    expect(pascalCase(splitWords('userIDs'), GO_INITIALISMS)).toBe('UserIDs');
    expect(pascalCase(splitWords('identity'), GO_INITIALISMS)).toBe('Identity');
  });

  it('handles empty word lists', () => {
    expect(pascalCase([])).toBe('');
    expect(camelCase([])).toBe('');
    expect(snakeCase([])).toBe('');
  });
});

describe('singularize', () => {
  it.each([
    ['users', 'user'],
    ['categories', 'category'],
    ['addresses', 'address'],
    ['boxes', 'box'],
    ['matches', 'match'],
    ['hashes', 'hash'],
    ['heroes', 'hero'],
    ['responses', 'response'],
    ['archives', 'archive'],
    ['leaves', 'leaf'],
    ['people', 'person'],
    ['children', 'child'],
    ['indices', 'index'],
    ['criteria', 'criterion'],
    ['statuses', 'status'],
    ['movies', 'movie'],
    ['caches', 'cache'],
    ['aliases', 'alias'],
    ['keys', 'key'],
    ['photos', 'photo'],
    ['Items', 'item'],
  ])('%s → %s', (plural, single) => {
    expect(singularize(plural)).toBe(single);
  });

  it.each(['data', 'info', 'news', 'series', 'status', 'address', 'analysis', 'history', 'matrix', 'canvas', 'as'])(
    'leaves %s alone',
    (word) => {
      expect(singularize(word)).toBeNull();
    },
  );
});

describe('itemWords', () => {
  it('singularizes the last word or appends Item', () => {
    expect(itemWords(['user', 'Addresses'])).toEqual(['user', 'address']);
    expect(itemWords(['data'])).toEqual(['data', 'Item']);
    expect(itemWords(['Root'])).toEqual(['Root', 'Item']);
    expect(itemWords([])).toEqual(['Item']);
    expect(itemWords(['v2'])).toEqual(['v2', 'Item']);
  });
});

describe('commonSuffix', () => {
  it('finds shared trailing words case-insensitively', () => {
    expect(commonSuffix([['billing', 'Address'], ['shipping', 'address']])).toEqual(['Address']);
    expect(commonSuffix([['a', 'b'], ['c', 'd']])).toEqual([]);
    expect(commonSuffix([['x']])).toEqual(['x']);
    expect(commonSuffix([])).toEqual([]);
  });
});

describe('Namer', () => {
  it('appends numbers on collisions', () => {
    const namer = new Namer();
    expect(namer.claim('Item')).toBe('Item');
    expect(namer.claim('Item')).toBe('Item2');
    expect(namer.claim('Item')).toBe('Item3');
  });

  it('escapes reserved names and avoids collisions with escaped names', () => {
    const namer = new Namer(new Set(['type', 'class']), { escape: (n) => `${n}_` });
    expect(namer.claim('type')).toBe('type_');
    expect(namer.claim('type_')).toBe('type_2');
    expect(namer.claim('name')).toBe('name');
  });

  it('numbers reserved names when there is no escape', () => {
    const namer = new Namer(new Set(['Object']));
    expect(namer.claim('Object')).toBe('Object2');
  });

  it('compares case-insensitively when asked', () => {
    const namer = new Namer(new Set(), { ignoreCase: true });
    expect(namer.claim('UserId')).toBe('UserId');
    expect(namer.claim('UserID')).toBe('UserID2');
  });

  it('uses a separator for suffixes when given', () => {
    const namer = new Namer(new Set(), { separator: '_' });
    namer.claim('name');
    expect(namer.claim('name')).toBe('name_2');
  });
});

describe('isAsciiIdentifier', () => {
  it('accepts plain identifiers only', () => {
    expect(isAsciiIdentifier('abc_1')).toBe(true);
    expect(isAsciiIdentifier('$x')).toBe(false);
    expect(isAsciiIdentifier('$x', true)).toBe(true);
    expect(isAsciiIdentifier('1x')).toBe(false);
    expect(isAsciiIdentifier('a-b')).toBe(false);
    expect(isAsciiIdentifier('')).toBe(false);
    expect(isAsciiIdentifier('名前')).toBe(false);
  });
});
