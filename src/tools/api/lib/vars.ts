import type { KeyValue } from './model';

/**
 * `{{name}}` variable substitution.
 *
 * - Whitespace inside the braces is ignored: `{{ host }}` equals `{{host}}`.
 * - Variable values may reference other variables; they are resolved recursively
 *   (up to {@link MAX_DEPTH} levels) and cycles are reported instead of looping.
 * - A backslash escapes the opening braces: `\{{name}}` produces the literal `{{name}}`.
 * - Unknown names are left untouched and reported as missing.
 * - Postman-style dynamic variables (`{{$guid}}`, `{{$timestamp}}`, …) work unless the scope defines the name.
 */

export const MAX_DEPTH = 10;

export type Scope = ReadonlyMap<string, string>;

/** Merge variable layers; later layers override earlier ones. Disabled rows and blank keys are ignored. */
export function buildScope(...layers: Array<ReadonlyArray<Pick<KeyValue, 'key' | 'value' | 'enabled'>> | undefined>): Map<string, string> {
  const scope = new Map<string, string>();
  for (const layer of layers) {
    for (const row of layer ?? []) {
      const key = row.key.trim();
      if (row.enabled && key) scope.set(key, row.value);
    }
  }
  return scope;
}

export interface DynamicVars {
  (name: string): string | undefined;
}

export const DYNAMIC_NAMES = ['$guid', '$uuid', '$randomUUID', '$timestamp', '$isoTimestamp', '$randomInt'];

export const defaultDynamicVars: DynamicVars = (name) => {
  switch (name) {
    case '$guid':
    case '$uuid':
    case '$randomUUID':
      return crypto.randomUUID();
    case '$timestamp':
      return String(Math.floor(Date.now() / 1000));
    case '$isoTimestamp':
      return new Date().toISOString();
    case '$randomInt':
      return String(Math.floor(Math.random() * 1001));
    default:
      return undefined;
  }
};

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'var'; text: string; name: string }
  | { type: 'escaped'; text: string };

const VAR_RE = /\\\{\{|\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

/** Split text into literal text, variable references and escaped braces (used for highlighting). */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  VAR_RE.lastIndex = 0;
  for (let m = VAR_RE.exec(text); m; m = VAR_RE.exec(text)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[0] === '\\{{') out.push({ type: 'escaped', text: m[0] });
    else out.push({ type: 'var', text: m[0], name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Names referenced by a text (in order, unique). */
export function referencedNames(text: string): string[] {
  const names: string[] = [];
  for (const s of segments(text)) if (s.type === 'var' && !names.includes(s.name)) names.push(s.name);
  return names;
}

export interface ResolveResult {
  text: string;
  /** Names that had no value (left as `{{name}}` in the output). */
  missing: string[];
  /** Names that form a reference cycle (left unresolved). */
  cyclic: string[];
}

export function resolveVars(text: string, scope: Scope, dynamic: DynamicVars | null = defaultDynamicVars): ResolveResult {
  const missing = new Set<string>();
  const cyclic = new Set<string>();

  const expand = (input: string, stack: string[]): string => {
    let out = '';
    for (const seg of segments(input)) {
      if (seg.type === 'text') out += seg.text;
      else if (seg.type === 'escaped') out += '{{';
      else {
        const name = seg.name;
        if (stack.includes(name)) {
          cyclic.add(name);
          out += seg.text;
        } else if (scope.has(name)) {
          if (stack.length >= MAX_DEPTH) {
            cyclic.add(name);
            out += seg.text;
          } else out += expand(scope.get(name)!, [...stack, name]);
        } else {
          const dyn = name.startsWith('$') && dynamic ? dynamic(name) : undefined;
          if (dyn !== undefined) out += dyn;
          else {
            missing.add(name);
            out += seg.text;
          }
        }
      }
    }
    return out;
  };

  const result = expand(text, []);
  return { text: result, missing: [...missing], cyclic: [...cyclic] };
}

/** Status of each variable name referenced in the text: resolved, missing or dynamic. */
export function variableStatus(name: string, scope: Scope): 'resolved' | 'dynamic' | 'missing' {
  if (scope.has(name)) return 'resolved';
  if (DYNAMIC_NAMES.includes(name)) return 'dynamic';
  return 'missing';
}
