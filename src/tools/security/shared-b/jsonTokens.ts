/** Splits pretty-printed JSON into coloured tokens for display (no HTML is produced). */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(json); m; m = TOKEN_RE.exec(json)) {
    if (m.index > last) tokens.push({ kind: 'punct', text: json.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ kind: m[2] ? 'key' : 'string', text: m[1] });
      if (m[2]) tokens.push({ kind: 'punct', text: m[2] });
    } else if (m[3] !== undefined) {
      tokens.push({ kind: 'literal', text: m[3] });
    } else {
      tokens.push({ kind: 'number', text: m[4] });
    }
    last = m.index + m[0].length;
  }
  if (last < json.length) tokens.push({ kind: 'punct', text: json.slice(last) });
  return tokens;
}

/** Pretty-prints any JSON value with 2-space indentation. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
