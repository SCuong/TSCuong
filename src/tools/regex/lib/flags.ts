export type RegexFlag = 'g' | 'i' | 'm' | 's' | 'u' | 'v' | 'y' | 'd';

export interface FlagInfo {
  flag: RegexFlag;
  name: string;
  description: string;
}

/** Flags the tester exposes, in the order JavaScript prints them (`RegExp.prototype.flags`). */
export const FLAGS: FlagInfo[] = [
  { flag: 'g', name: 'global', description: 'Find all matches instead of stopping after the first' },
  { flag: 'i', name: 'ignore case', description: 'Letters match regardless of case' },
  { flag: 'm', name: 'multiline', description: '^ and $ match at the start and end of every line' },
  { flag: 's', name: 'dot all', description: '. also matches line breaks' },
  { flag: 'u', name: 'unicode', description: 'Code-point matching, \\p{...} properties and strict syntax' },
  { flag: 'v', name: 'unicode sets', description: 'Like u, plus set operations ([\\w--\\d]), nested classes and \\q{...}' },
  { flag: 'y', name: 'sticky', description: 'Matches must start exactly where the previous match ended' },
];

const ORDER = 'dgimsuvy';

const support = new Map<string, boolean>();

/** Whether this JavaScript engine accepts the flag (e.g. `v` needs a 2023+ browser). */
export function isFlagSupported(flag: string): boolean {
  let ok = support.get(flag);
  if (ok === undefined) {
    try {
      new RegExp('', flag);
      ok = true;
    } catch {
      ok = false;
    }
    support.set(flag, ok);
  }
  return ok;
}

/** Deduplicate, drop unknown letters and sort into the canonical order. */
export function normalizeFlags(flags: string): string {
  return [...new Set(flags)].filter((f) => ORDER.includes(f)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('');
}

/** Toggle one flag; `u` and `v` are mutually exclusive, so turning one on turns the other off. */
export function toggleFlag(flags: string, flag: RegexFlag): string {
  if (flags.includes(flag)) return normalizeFlags(flags.replace(flag, ''));
  let next = flags + flag;
  if (flag === 'u') next = next.replace('v', '');
  if (flag === 'v') next = next.replace('u', '');
  return normalizeFlags(next);
}

/** Flags used for matching: the user's flags plus `d` for group positions. */
export function matchingFlags(flags: string): string {
  return normalizeFlags(flags.includes('d') ? flags : flags + 'd');
}
