/** Batch rename engine: pattern tokens, find/replace, case changes and conflict detection. Pure. */

export interface RenameFile {
  name: string;
  size: number;
  lastModified: number;
  /** Relative path including the name (e.g. from a folder pick), if known. */
  path?: string;
}

export type CaseMode = 'keep' | 'lower' | 'upper' | 'title' | 'camel' | 'kebab' | 'snake';
export type ExtMode = 'keep' | 'lower' | 'upper' | 'change' | 'remove';
export type SortMode = 'original' | 'name' | 'date' | 'size';

export interface RenameOptions {
  pattern: string;
  find: string;
  replace: string;
  regex: boolean;
  matchCase: boolean;
  /** Replace all occurrences (otherwise only the first). */
  replaceAll: boolean;
  caseMode: CaseMode;
  extMode: ExtMode;
  newExt: string;
  start: number;
  step: number;
  collapseSpaces: boolean;
  sort: SortMode;
}

export const DEFAULT_OPTIONS: RenameOptions = {
  pattern: '{name}',
  find: '',
  replace: '',
  regex: false,
  matchCase: false,
  replaceAll: true,
  caseMode: 'keep',
  extMode: 'keep',
  newExt: '',
  start: 1,
  step: 1,
  collapseSpaces: true,
  sort: 'original',
};

export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatDate(ts: number, fmt = 'YYYY-MM-DD'): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return fmt.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (t) => {
    switch (t) {
      case 'YYYY':
        return String(d.getFullYear());
      case 'YY':
        return String(d.getFullYear()).slice(-2);
      case 'MM':
        return pad2(d.getMonth() + 1);
      case 'DD':
        return pad2(d.getDate());
      case 'HH':
        return pad2(d.getHours());
      case 'mm':
        return pad2(d.getMinutes());
      default:
        return pad2(d.getSeconds());
    }
  });
}

function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);
}

export function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case 'keep':
      return s;
    case 'lower':
      return s.toLowerCase();
    case 'upper':
      return s.toUpperCase();
    case 'title':
      return s.toLowerCase().replace(/(^|[\s_\-(.[])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    case 'camel':
      return words(s)
        .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join('');
    case 'kebab':
      return words(s)
        .map((w) => w.toLowerCase())
        .join('-');
    case 'snake':
      return words(s)
        .map((w) => w.toLowerCase())
        .join('_');
  }
}

/** Validate the find/replace settings; returns an error message or null. */
export function findError(o: Pick<RenameOptions, 'find' | 'regex' | 'matchCase'>): string | null {
  if (!o.regex || !o.find) return null;
  try {
    new RegExp(o.find, o.matchCase ? 'u' : 'iu');
    return null;
  } catch (e) {
    return `Invalid regular expression: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}`;
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Expand pattern tokens for one file. Unknown tokens are left as typed. */
export function expandPattern(pattern: string, f: RenameFile, counter: number): string {
  const { base, ext } = splitName(f.name);
  const parent = f.path && f.path.includes('/') ? f.path.split('/').slice(-2, -1)[0] : '';
  return pattern.replace(/\{(\w+)(?::([^}]*))?\}/g, (whole, token: string, arg?: string) => {
    switch (token) {
      case 'name':
        return base;
      case 'ext':
        return ext;
      case 'original':
        return f.name;
      case 'n': {
        const width = arg && /^\d{1,2}$/.test(arg) ? Number(arg) : 0;
        const neg = counter < 0;
        const s = String(Math.abs(counter)).padStart(width, '0');
        return neg ? `-${s}` : s;
      }
      case 'date':
        return formatDate(f.lastModified, arg || 'YYYY-MM-DD');
      case 'size':
        return String(f.size);
      case 'parent':
        return parent;
      default:
        return whole;
    }
  });
}

export function sortFiles<T extends RenameFile>(files: T[], sort: SortMode): T[] {
  const list = files.map((f, i) => ({ f, i }));
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (sort === 'name') list.sort((a, b) => collator.compare(a.f.name, b.f.name) || a.i - b.i);
  else if (sort === 'date') list.sort((a, b) => a.f.lastModified - b.f.lastModified || a.i - b.i);
  else if (sort === 'size') list.sort((a, b) => a.f.size - b.f.size || a.i - b.i);
  return list.map((x) => x.f);
}

/** Compute the new name for each file (in the given order). Throws on an invalid regex. */
export function computeNames(files: RenameFile[], o: RenameOptions): string[] {
  const err = findError(o);
  if (err) throw new Error(err);
  let re: RegExp | null = null;
  if (o.find) {
    const flags = `${o.replaceAll ? 'g' : ''}${o.matchCase ? '' : 'i'}u`;
    re = new RegExp(o.regex ? o.find : escapeRegExp(o.find), flags);
  }
  return files.map((f, i) => {
    const counter = o.start + i * o.step;
    const { ext } = splitName(f.name);
    let base = expandPattern(o.pattern || '{name}', f, counter);
    if (re) {
      re.lastIndex = 0;
      base = o.regex ? base.replace(re, o.replace) : base.replace(re, () => o.replace);
    }
    base = applyCase(base, o.caseMode);
    if (o.collapseSpaces) base = base.replace(/\s+/g, ' ').trim();
    let newExt = ext;
    if (o.extMode === 'lower') newExt = ext.toLowerCase();
    else if (o.extMode === 'upper') newExt = ext.toUpperCase();
    else if (o.extMode === 'change') newExt = o.newExt.replace(/^\.+/, '').trim();
    else if (o.extMode === 'remove') newExt = '';
    return newExt ? `${base}.${newExt}` : base;
  });
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\x00-\x1f]/;

export type Problem = 'duplicate' | 'empty' | 'invalid-chars' | 'reserved' | 'trailing' | 'too-long';

export const PROBLEM_TEXT: Record<Problem, string> = {
  duplicate: 'Duplicate name',
  empty: 'Empty name',
  'invalid-chars': 'Contains < > : " / \\ | ? * or control characters',
  reserved: 'Reserved name on Windows',
  trailing: 'Ends with a space or dot (not allowed on Windows)',
  'too-long': 'Longer than 255 characters',
};

/** Problems for each proposed name. */
export function findProblems(names: string[], caseInsensitive = true): Problem[][] {
  const key = (n: string) => (caseInsensitive ? n.toLowerCase() : n);
  const counts = new Map<string, number>();
  for (const n of names) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1);
  return names.map((n) => {
    const p: Problem[] = [];
    if (!n || !splitName(n).base.trim()) p.push('empty');
    if (INVALID.test(n)) p.push('invalid-chars');
    if (RESERVED.test(n)) p.push('reserved');
    if (/[ .]$/.test(n)) p.push('trailing');
    if (n.length > 255) p.push('too-long');
    if (n && (counts.get(key(n)) ?? 0) > 1) p.push('duplicate');
    return p;
  });
}
