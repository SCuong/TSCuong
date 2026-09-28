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
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/**
 * Parse an ignore list: one pattern per line (or comma separated), `#` starts
 * a comment, `*`/`?` are wildcards, `**` crosses folders, a leading or
 * trailing `/` is ignored.
 */
export function parseIgnoreList(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const line = raw.replace(/#.*$/, '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    rules.push({ pattern: line, regex: globToRegex(line), anchored: line.includes('/') });
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
