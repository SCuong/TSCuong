/** RFC 6901 JSON Pointer helpers. The root pointer is the empty string. */

export function escapeToken(token: string | number): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function toPointer(tokens: ReadonlyArray<string | number>): string {
  return tokens.map((t) => `/${escapeToken(t)}`).join('');
}

/** Unescaped reference tokens of a pointer ("" → [], "/a~1b/0" → ["a/b", "0"]). */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map(unescapeToken);
}

/**
 * Converts a location reported by @cfworker/json-schema ("#", "#/a%20b/0") into a
 * plain JSON Pointer ("", "/a b/0"). The validator percent-encodes escaped tokens.
 */
export function fromLocation(location: string): string {
  const body = location.startsWith('#') ? location.slice(1) : location;
  if (!body) return '';
  return body
    .split('/')
    .slice(1)
    .map((segment) => {
      try {
        return `/${decodeURIComponent(segment)}`;
      } catch {
        return `/${segment}`;
      }
    })
    .join('');
}

/** Value at a pointer inside a parsed JSON value, or `undefined` when it does not exist. */
export function valueAt(root: unknown, pointer: string): unknown {
  let cur: unknown = root;
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return undefined;
      cur = cur[Number(token)];
    } else if (cur && typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, token)) return undefined;
      cur = (cur as Record<string, unknown>)[token];
    } else return undefined;
  }
  return cur;
}

/** Parent pointer ("/a/b" → "/a"); the root has no parent. */
export function parentPointer(pointer: string): string | null {
  if (pointer === '') return null;
  return pointer.slice(0, pointer.lastIndexOf('/'));
}

/** Last unescaped token of a pointer ("/a/b~1c" → "b/c"). */
export function lastToken(pointer: string): string {
  return unescapeToken(pointer.slice(pointer.lastIndexOf('/') + 1));
}
