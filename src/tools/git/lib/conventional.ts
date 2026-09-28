/**
 * Conventional Commits 1.0.0: message builder and linter.
 * https://www.conventionalcommits.org/en/v1.0.0/
 */

export interface CommitType {
  type: string;
  title: string;
  description: string;
}

/** The Angular/commitlint type list, which most projects use. */
export const COMMIT_TYPES: CommitType[] = [
  { type: 'feat', title: 'Feature', description: 'A new feature (minor version bump)' },
  { type: 'fix', title: 'Bug fix', description: 'A bug fix (patch version bump)' },
  { type: 'docs', title: 'Documentation', description: 'Documentation only changes' },
  { type: 'style', title: 'Style', description: 'Formatting, white-space, semicolons; no code meaning changes' },
  { type: 'refactor', title: 'Refactor', description: 'Code change that neither fixes a bug nor adds a feature' },
  { type: 'perf', title: 'Performance', description: 'A code change that improves performance' },
  { type: 'test', title: 'Tests', description: 'Adding missing tests or correcting existing tests' },
  { type: 'build', title: 'Build', description: 'Build system or external dependencies (npm, gradle, ...)' },
  { type: 'ci', title: 'CI', description: 'CI configuration files and scripts' },
  { type: 'chore', title: 'Chore', description: "Other changes that don't modify src or test files" },
  { type: 'revert', title: 'Revert', description: 'Reverts a previous commit' },
];

const KNOWN_TYPES = new Set(COMMIT_TYPES.map((t) => t.type));

export interface Footer {
  token: string;
  value: string;
}

export interface CommitInput {
  type: string;
  scope: string;
  breaking: boolean;
  subject: string;
  body: string;
  /** Description of the breaking change (becomes a BREAKING CHANGE footer). */
  breakingDescription: string;
  /** Issue references such as "#12, #15" or "PROJ-7". */
  closes: string;
  footers: Footer[];
  /** Hard-wrap body paragraphs at this width (0 = off). */
  wrap: number;
}

/** Word-wrap one paragraph, keeping lines that look like lists or code as they are. */
export function wrapText(text: string, width: number): string {
  if (width <= 0) return text;
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= width) return line;
      if (/^( {4,}|\t)/.test(line) || /^\s*(```|>)/.test(line)) return line; // code or quote
      const indent = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line)?.[1] ?? '';
      const hang = ' '.repeat(indent.length);
      const words = line.slice(indent.length).split(/ +/);
      const out: string[] = [];
      let current = indent;
      for (const word of words) {
        const prefix = out.length ? hang : indent;
        if (current.length > prefix.length && current.length + 1 + word.length > width) {
          out.push(current);
          current = hang + word;
        } else {
          current = current.length > prefix.length ? `${current} ${word}` : current + word;
        }
      }
      out.push(current);
      return out.join('\n');
    })
    .join('\n');
}

/** Split an issue list ("#1, #2 PROJ-3") into individual references. */
export function parseIssueRefs(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildCommitMessage(input: CommitInput): string {
  const type = input.type.trim();
  const scope = input.scope.trim();
  const subject = input.subject.trim().replace(/\s+/g, ' ');
  const header = `${type}${scope ? `(${scope})` : ''}${input.breaking ? '!' : ''}: ${subject}`;
  const parts = [header];
  const body = input.body.replace(/\s+$/, '').replace(/^\n+/, '');
  if (body.trim()) parts.push(wrapText(body, input.wrap));
  const footers: string[] = [];
  if (input.breaking && input.breakingDescription.trim()) {
    footers.push(wrapFooter(`BREAKING CHANGE: ${input.breakingDescription.trim()}`, input.wrap));
  }
  for (const ref of parseIssueRefs(input.closes)) {
    footers.push(`Closes ${/^\d+$/.test(ref) ? `#${ref}` : ref}`);
  }
  for (const f of input.footers) {
    const token = f.token.trim();
    const value = f.value.trim();
    if (!token || !value) continue;
    const t = /^breaking[ -]change$/i.test(token) ? 'BREAKING CHANGE' : token.replace(/\s+/g, '-');
    footers.push(value.startsWith('#') && t !== 'BREAKING CHANGE' ? `${t} ${value}` : `${t}: ${value}`);
  }
  if (footers.length) parts.push(footers.join('\n'));
  return parts.join('\n\n');
}

function wrapFooter(text: string, width: number): string {
  return width > 0 ? wrapText(text, width) : text;
}

// ---------------------------------------------------------------------------
// Linter
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info';

export interface LintIssue {
  severity: Severity;
  message: string;
  /** 1-based line of the message the issue refers to. */
  line: number;
}

export interface ParsedHeader {
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
}

export interface LintResult {
  issues: LintIssue[];
  header: ParsedHeader | null;
  /** Footers recognised in the last paragraph. */
  footers: Footer[];
  /** True when the message declares a breaking change (! or BREAKING CHANGE footer). */
  breaking: boolean;
  /** The message was generated by git (merge, revert, fixup) and is usually exempt. */
  exempt: string | null;
  valid: boolean;
}

export interface LintOptions {
  maxHeaderLength: number;
  maxBodyLineLength: number;
  /** Additional allowed types (besides the standard list). */
  extraTypes: string[];
}

export const DEFAULT_LINT_OPTIONS: LintOptions = { maxHeaderLength: 72, maxBodyLineLength: 100, extraTypes: [] };

const HEADER_RE = /^(?<type>[^\s():!]+)(?:\((?<scope>[^()]*)\))?(?<bang>!)?(?<colon>:?)(?<space> ?)(?<desc>.*)$/;
const FOOTER_RE = /^(?<token>BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][\w-]*)(?<sep>: | #)(?<value>.*)$/;

/** Non-imperative first words and their imperative form. */
const IMPERATIVE: Record<string, string> = {
  added: 'add',
  adds: 'add',
  adding: 'add',
  fixed: 'fix',
  fixes: 'fix',
  fixing: 'fix',
  updated: 'update',
  updates: 'update',
  updating: 'update',
  removed: 'remove',
  removes: 'remove',
  removing: 'remove',
  changed: 'change',
  changes: 'change',
  changing: 'change',
  created: 'create',
  creates: 'create',
  creating: 'create',
  deleted: 'delete',
  deletes: 'delete',
  deleting: 'delete',
  implemented: 'implement',
  implements: 'implement',
  implementing: 'implement',
  improved: 'improve',
  improves: 'improve',
  improving: 'improve',
  refactored: 'refactor',
  refactors: 'refactor',
  refactoring: 'refactor',
  renamed: 'rename',
  renames: 'rename',
  renaming: 'rename',
  moved: 'move',
  moves: 'move',
  moving: 'move',
  bumped: 'bump',
  bumps: 'bump',
  bumping: 'bump',
  upgraded: 'upgrade',
  upgrades: 'upgrade',
  upgrading: 'upgrade',
  merged: 'merge',
  merges: 'merge',
  reverted: 'revert',
  reverts: 'revert',
  made: 'make',
  makes: 'make',
  making: 'make',
  used: 'use',
  uses: 'use',
  using: 'use',
  allowed: 'allow',
  allows: 'allow',
  handled: 'handle',
  handles: 'handle',
  corrected: 'correct',
  corrects: 'correct',
  cleaned: 'clean',
  cleans: 'clean',
  documented: 'document',
  documents: 'document',
  introduced: 'introduce',
  introduces: 'introduce',
  replaced: 'replace',
  replaces: 'replace',
  optimized: 'optimize',
  optimizes: 'optimize',
  supported: 'support',
  supports: 'support',
  prevented: 'prevent',
  prevents: 'prevent',
  ensured: 'ensure',
  ensures: 'ensure',
};

function imperativeHint(description: string): string | null {
  const first = /^[A-Za-z]+/.exec(description)?.[0];
  if (!first) return null;
  const lower = first.toLowerCase();
  const suggestion = IMPERATIVE[lower];
  if (suggestion) return `Use the imperative mood: “${suggestion}” instead of “${first}” (write it as a command: “${suggestion} …”).`;
  return null;
}

/** Messages git itself generates; conventional-commit tools usually ignore them. */
function exemptKind(header: string): string | null {
  if (/^Merge (branch|pull request|remote-tracking branch|tag|commit|[0-9a-f]{7,40}\b)/.test(header)) return 'merge commit';
  if (/^Revert "/.test(header)) return 'git revert message';
  if (/^(fixup|squash|amend)! /.test(header)) return 'fixup/squash commit';
  if (/^Initial commit$/i.test(header)) return 'initial commit';
  return null;
}

export function lintCommitMessage(raw: string, options: LintOptions = DEFAULT_LINT_OPTIONS): LintResult {
  // Drop git's comment lines (from the commit template) and the scissors section.
  const all = raw.replace(/\r\n?/g, '\n').split('\n');
  const scissors = all.findIndex((l) => /^# -+ >8 -+$/.test(l));
  const lines = (scissors >= 0 ? all.slice(0, scissors) : all).map((l, i) => ({ text: l, no: i + 1 })).filter((l) => !l.text.startsWith('#'));
  while (lines.length && lines[lines.length - 1].text.trim() === '') lines.pop();
  while (lines.length && lines[0].text.trim() === '') lines.shift();

  const issues: LintIssue[] = [];
  const add = (severity: Severity, message: string, line: number) => issues.push({ severity, message, line });
  const result: LintResult = { issues, header: null, footers: [], breaking: false, exempt: null, valid: false };
  if (!lines.length) return result;

  const headerLine = lines[0];
  const headerText = headerLine.text;
  result.exempt = exemptKind(headerText);
  if (result.exempt) {
    add('info', `This looks like a ${result.exempt} generated by git; commit linters normally skip these.`, headerLine.no);
    result.valid = true;
    return result;
  }

  // ---- header -------------------------------------------------------------
  const allowed = new Set([...KNOWN_TYPES, ...options.extraTypes.map((t) => t.toLowerCase())]);
  const m = HEADER_RE.exec(headerText.trimEnd());
  if (!m?.groups || !m.groups.colon) {
    add('error', 'The first line must look like “type(scope): description”, e.g. “feat(parser): add array support”.', headerLine.no);
  } else {
    const { type, scope, bang, space, desc } = m.groups;
    const header: ParsedHeader = { type, scope: scope ?? null, breaking: Boolean(bang), description: desc };
    result.header = header;
    if (!/^[A-Za-z][\w-]*$/.test(type)) {
      add('error', `The type “${type}” must be a single word made of letters (e.g. feat, fix).`, headerLine.no);
    } else if (!allowed.has(type.toLowerCase())) {
      add('warning', `“${type}” is not a standard type. Common types: ${[...KNOWN_TYPES].join(', ')}.`, headerLine.no);
    } else if (type !== type.toLowerCase()) {
      add('warning', `Write the type in lowercase (“${type.toLowerCase()}”) for consistency.`, headerLine.no);
    }
    if (scope !== undefined) {
      if (!scope.trim()) add('error', 'The scope in parentheses is empty. Remove the parentheses or name a scope.', headerLine.no);
      else if (/\s/.test(scope)) add('warning', `The scope “${scope}” contains spaces; use a single noun such as “${scope.trim().replace(/\s+/g, '-')}”.`, headerLine.no);
    }
    if (!space) add('error', 'Put a single space after the colon.', headerLine.no);
    const description = desc.trim();
    if (!description) {
      add('error', 'The description after the colon is missing.', headerLine.no);
    } else {
      if (/^\s/.test(desc)) add('warning', 'Use exactly one space after the colon.', headerLine.no);
      if (/\.$/.test(description) && !/\.\.\.$/.test(description)) add('warning', 'Do not end the description with a period.', headerLine.no);
      if (/^[A-Z][a-z]/.test(description)) {
        add('warning', 'Start the description with a lowercase letter (most projects use lowercase, e.g. “add …”).', headerLine.no);
      }
      const hint = imperativeHint(description);
      if (hint) add('warning', hint, headerLine.no);
    }
    if (headerText.length > options.maxHeaderLength) {
      add('warning', `The first line is ${headerText.length} characters; keep it at most ${options.maxHeaderLength}.`, headerLine.no);
    }
    if (header.breaking) result.breaking = true;
  }

  // ---- body and footers ---------------------------------------------------
  if (lines.length > 1) {
    if (lines[1].text.trim() !== '') add('error', 'Leave a blank line between the first line and the body.', lines[1].no);
    const rest = lines.slice(1);
    // Paragraphs separated by blank lines.
    const paragraphs: Array<typeof lines> = [];
    let current: typeof lines = [];
    for (const l of rest) {
      if (l.text.trim() === '') {
        if (current.length) paragraphs.push(current);
        current = [];
      } else current.push(l);
    }
    if (current.length) paragraphs.push(current);

    // The footer section is the final paragraph if it starts with a footer token.
    let footerPara: typeof lines | null = null;
    const last = paragraphs[paragraphs.length - 1];
    const looksLikeFooter = (t: string) => FOOTER_RE.test(t) || /^breaking[ -]change\s*:/i.test(t);
    if (last && looksLikeFooter(last[0].text) && (paragraphs.length > 1 || lines[1].text.trim() === '')) footerPara = last;
    const bodyParas = footerPara ? paragraphs.slice(0, -1) : paragraphs;

    for (const para of bodyParas) {
      for (const l of para) {
        if (l.text.length > options.maxBodyLineLength && !/https?:\/\//.test(l.text)) {
          add('warning', `Body line is ${l.text.length} characters; wrap it at ${options.maxBodyLineLength} or fewer.`, l.no);
        }
        if (/^BREAKING[ -]CHANGE:/.test(l.text)) {
          add('error', 'A BREAKING CHANGE footer must be in the last paragraph (the footer section).', l.no);
        }
      }
    }

    if (footerPara) {
      let currentFooter: Footer | null = null;
      for (const l of footerPara) {
        const fm = FOOTER_RE.exec(l.text);
        if (fm?.groups) {
          currentFooter = { token: fm.groups.token, value: fm.groups.value };
          result.footers.push(currentFooter);
          const token = fm.groups.token;
          if (/^breaking[ -]change$/i.test(token)) {
            result.breaking = true;
            if (token !== token.toUpperCase()) add('error', '“BREAKING CHANGE” must be written in uppercase.', l.no);
            if (fm.groups.sep !== ': ') add('error', 'Write the breaking change footer as “BREAKING CHANGE: description”.', l.no);
            if (!fm.groups.value.trim()) add('error', 'The BREAKING CHANGE footer needs a description.', l.no);
          }
        } else if (/^breaking change\s*:/i.test(l.text)) {
          add('error', '“BREAKING CHANGE” must be written in uppercase.', l.no);
        } else if (/^[A-Za-z][\w-]*( [\w-]+)+: /.test(l.text)) {
          add('error', `Footer tokens cannot contain spaces: use “${l.text.split(':')[0].replace(/ /g, '-')}”.`, l.no);
        } else if (currentFooter) {
          currentFooter.value += `\n${l.text}`;
        }
        if (l.text.length > options.maxBodyLineLength && !/https?:\/\//.test(l.text)) {
          add('warning', `Footer line is ${l.text.length} characters; wrap it at ${options.maxBodyLineLength} or fewer.`, l.no);
        }
      }
    } else {
      // A footer-looking paragraph that is not last, or a lowercase breaking change.
      for (const para of paragraphs) {
        for (const l of para) {
          if (/^breaking change\s*:/.test(l.text)) add('error', '“BREAKING CHANGE” must be written in uppercase.', l.no);
        }
      }
    }
  }

  if (result.breaking && result.header && !result.header.breaking) {
    add('info', 'Tip: add “!” before the colon (e.g. “feat!:”) so the breaking change is visible in the first line.', headerLine.no);
  }
  if (result.header?.breaking && !result.footers.some((f) => /^breaking[ -]change$/i.test(f.token))) {
    add('info', 'Consider adding a “BREAKING CHANGE: …” footer that explains what breaks and how to migrate.', headerLine.no);
  }

  issues.sort((a, b) => a.line - b.line || rank(a.severity) - rank(b.severity));
  result.valid = !issues.some((i) => i.severity === 'error');
  return result;
}

function rank(s: Severity): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}
