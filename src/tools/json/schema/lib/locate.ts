import { createLineIndex } from '../../lib/jsonScan';
import { escapeToken } from './pointer';

export interface Span {
  from: number;
  to: number;
}

export interface NodeLocation {
  /** The value's source range. */
  value: Span;
  /** The property name's range (quotes included) when the node is an object member. */
  key?: Span;
}

export interface TextPosition {
  line: number;
  column: number;
  /** Characters to highlight, never crossing the end of the line. */
  length: number;
}

/**
 * Finds where the nodes addressed by JSON Pointers sit in JSON source text, in a
 * single pass. Only the branches leading to requested pointers are parsed; other
 * values are skipped without recursion, so large and deeply nested documents are
 * cheap. For duplicate keys the last occurrence wins, like JSON.parse. Stops
 * quietly at malformed input and returns what it found.
 */
export function locatePointers(text: string, pointers: Iterable<string>): Map<string, NodeLocation> {
  const wanted = new Set(pointers);
  const prefixes = new Set<string>();
  for (const p of wanted) {
    let cut = p.lastIndexOf('/');
    while (cut >= 0) {
      const prefix = p.slice(0, cut);
      if (prefixes.has(prefix)) break;
      prefixes.add(prefix);
      cut = prefix.lastIndexOf('/');
    }
  }
  const found = new Map<string, NodeLocation>();
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else break;
    }
  };

  /** Skips a string starting at its opening quote; returns the decoded value when asked. */
  const string = (decode: boolean): string => {
    const start = i;
    i++;
    let escaped = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 92) {
        escaped = true;
        i += 2;
        continue;
      }
      if (c === 34) break;
      i++;
    }
    if (i >= n) throw new Error('unterminated');
    i++;
    if (!decode) return '';
    const raw = text.slice(start + 1, i - 1);
    return escaped ? (JSON.parse(`"${raw}"`) as string) : raw;
  };

  const skipValue = () => {
    const c = text.charCodeAt(i);
    if (c === 34) {
      string(false);
      return;
    }
    if (c === 123 || c === 91) {
      let depth = 0;
      while (i < n) {
        const ch = text.charCodeAt(i);
        if (ch === 34) {
          string(false);
          continue;
        }
        if (ch === 123 || ch === 91) depth++;
        else if (ch === 125 || ch === 93) {
          depth--;
          if (depth === 0) {
            i++;
            return;
          }
        }
        i++;
      }
      throw new Error('unterminated');
    }
    // Number or literal.
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 44 || ch === 125 || ch === 93 || ch === 32 || ch === 10 || ch === 13 || ch === 9) break;
      i++;
    }
  };

  const visit = (pointer: string, key?: Span) => {
    const start = i;
    const c = text.charCodeAt(i);
    if (c === 123 && prefixes.has(pointer)) {
      i++;
      ws();
      if (text.charCodeAt(i) === 125) i++;
      else {
        while (i < n) {
          ws();
          const keyStart = i;
          const name = string(true);
          const keySpan = { from: keyStart, to: i };
          ws();
          if (text.charCodeAt(i) !== 58) throw new Error('colon');
          i++;
          ws();
          const child = `${pointer}/${escapeToken(name)}`;
          if (wanted.has(child) || prefixes.has(child)) visit(child, keySpan);
          else skipValue();
          ws();
          const next = text.charCodeAt(i);
          i++;
          if (next === 125) break;
          if (next !== 44) throw new Error('separator');
        }
      }
    } else if (c === 91 && prefixes.has(pointer)) {
      i++;
      ws();
      if (text.charCodeAt(i) === 93) i++;
      else {
        let index = 0;
        while (i < n) {
          ws();
          const child = `${pointer}/${index}`;
          if (wanted.has(child) || prefixes.has(child)) visit(child);
          else skipValue();
          index++;
          ws();
          const next = text.charCodeAt(i);
          i++;
          if (next === 93) break;
          if (next !== 44) throw new Error('separator');
        }
      }
    } else skipValue();
    if (wanted.has(pointer)) found.set(pointer, key ? { value: { from: start, to: i }, key } : { value: { from: start, to: i } });
  };

  try {
    ws();
    if (i < n) visit('');
  } catch {
    // Malformed input: keep what was located before the problem.
  }
  return found;
}

/**
 * Line/column (1-based) and a single-line highlight length for spans in `text`.
 * Reuse the returned function for many lookups (the line index is built once).
 */
export function positionFinder(text: string): (span: Span) => TextPosition {
  const index = createLineIndex(text);
  return (span) => {
    const { line, column } = index(span.from);
    let end = span.from;
    while (end < span.to && end < text.length) {
      const c = text.charCodeAt(end);
      if (c === 10 || c === 13) break;
      end++;
    }
    return { line, column, length: Math.max(1, end - span.from) };
  };
}
