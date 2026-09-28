import { JSONPathError, query } from 'json-p3';

export interface PathMatch {
  /** Normalized path (RFC 9535), e.g. $['store']['book'][0]. */
  path: string;
  /** Shorthand path, e.g. $.store.book[0]. */
  pretty: string;
  pointer: string;
  value: unknown;
}

export type PathQueryResult =
  | { ok: true; matches: PathMatch[]; truncated: boolean }
  | { ok: false; message: string; index: number | null };

/** Strip json-p3's "('snippet':12)" suffix; we show the position ourselves. */
function cleanMessage(message: string): string {
  const cleaned = message.replace(/\s*\('[\s\S]*':\d+\)\s*$/, '').trim();
  const text = cleaned || message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Runs an RFC 9535 JSONPath query. Never throws. */
export function runJsonPath(expression: string, value: unknown, limit = 5000): PathQueryResult {
  const expr = expression.trim();
  if (!expr) return { ok: false, message: 'Enter a JSONPath expression, e.g. $.store.book[*].title', index: null };
  if (!expr.startsWith('$')) return { ok: false, message: 'A JSONPath query must start with $ (the root)', index: 0 };
  try {
    const nodes = query(expr, value);
    const all = nodes.nodes;
    const matches = all.slice(0, limit).map((node) => ({
      path: node.getPath({ form: 'canonical' }),
      pretty: node.getPath({ form: 'pretty' }),
      pointer: node.toPointer().toString(),
      value: node.value,
    }));
    return { ok: true, matches, truncated: all.length > limit };
  } catch (error) {
    if (error instanceof JSONPathError) {
      const index = typeof error.token?.index === 'number' ? error.token.index : null;
      return { ok: false, message: cleanMessage(error.message), index };
    }
    if (error instanceof RangeError) return { ok: false, message: 'The query recursed too deeply for this document', index: null };
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid JSONPath expression', index: null };
  }
}

export const JSONPATH_EXAMPLES: Array<{ expr: string; description: string }> = [
  { expr: '$', description: 'The whole document (root)' },
  { expr: '$.store.book[*].author', description: 'Authors of all books' },
  { expr: '$..author', description: 'Every author, at any depth' },
  { expr: '$.store.*', description: 'All direct children of store' },
  { expr: '$.store..price', description: 'All prices inside store' },
  { expr: '$..book[2]', description: 'Third book' },
  { expr: '$..book[-1]', description: 'Last book' },
  { expr: '$..book[0,1]', description: 'First two books (union)' },
  { expr: '$..book[:2]', description: 'First two books (slice)' },
  { expr: '$..book[?@.isbn]', description: 'Books that have an isbn' },
  { expr: '$..book[?@.price < 10]', description: 'Books cheaper than 10' },
  { expr: "$..book[?@.category == 'fiction']", description: 'Filter by string equality' },
  { expr: "$..book[?match(@.author, '.*Tolkien.*')]", description: 'Regex match (whole string)' },
  { expr: "$..book[?search(@.title, 'ring')]", description: 'Regex search (substring)' },
  { expr: '$..book[?length(@.tags) > 1]', description: 'Function: length()' },
  { expr: "$['store']['bicycle']", description: 'Bracket notation for names' },
  { expr: '$..*', description: 'Every node in the document' },
];
