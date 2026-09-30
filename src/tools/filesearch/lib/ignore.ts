/** Ignore rules for folder indexing. */

export const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.gradle',
  '.idea',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'bower_components',
  'dist',
  'build',
  'coverage',
  'target',
  '.DS_Store',
  'Thumbs.db',
];

export interface IgnoreRule {
  /** Original pattern text. */
  pattern: string;
  regex: RegExp;
  /** Patterns containing "/" match the whole relative path; others match any single path segment. */
  anchored: boolean;
}

function globToRegex(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // "**/" also matches zero folders (a/**/b matches a/b), as in .gitignore.
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i++;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/**
 * Parse an ignore list: one pattern per line (or comma separated), `#` starts
 * a comment, `*`/`?` are wildcards and `**` crosses folders. A pattern without
 * "/" matches a file or folder name anywhere; with a "/" (including a leading
 * one, as in .gitignore) it matches a path from the indexed folder's root.
 * A trailing "/" is ignored.
 */
export function parseIgnoreList(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const trimmed = raw.replace(/#.*$/, '').trim().replace(/\\/g, '/');
    const line = trimmed.replace(/^\/+|\/+$/g, '');
    const anchored = trimmed.startsWith('/') || line.includes('/');
    const key = `${anchored ? '/' : ''}${line.toLowerCase()}`;
    if (!line || seen.has(key)) continue;
    seen.add(key);
    rules.push({ pattern: line, regex: globToRegex(line), anchored });
  }
  return rules;
}

/** True when a file or folder at `path` (relative, "/"-separated) should be skipped. */
export function isIgnored(path: string, rules: IgnoreRule[], skipHidden = false): boolean {
  const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!clean) return false;
  const segments = clean.split('/');
  if (skipHidden && segments.some((s) => s.startsWith('.') && s !== '.' && s !== '..')) return true;
  for (const rule of rules) {
    if (rule.anchored) {
      // Match the path itself or any parent folder of it.
      for (let i = 1; i <= segments.length; i++) {
        if (rule.regex.test(segments.slice(0, i).join('/'))) return true;
      }
    } else if (segments.some((s) => rule.regex.test(s))) {
      return true;
    }
  }
  return false;
}
