import {
  parsePattern,
  type AlternativeNode,
  type AtomNode,
  type CaptureGroupInfo,
  type CharNode,
  type ClassItem,
  type ClassNode,
  type DisjunctionNode,
  type PropertyNode,
  type ShorthandKind,
  type TermNode,
} from './parser';

export type ExplainKind =
  | 'literal'
  | 'char'
  | 'class'
  | 'group'
  | 'lookaround'
  | 'anchor'
  | 'alternation'
  | 'reference'
  | 'any';

export interface ExplainNode {
  /** Source text of the token (e.g. `\d+`). */
  raw: string;
  start: number;
  end: number;
  kind: ExplainKind;
  text: string;
  children?: ExplainNode[];
}

export interface Explanation {
  nodes: ExplainNode[];
  groups: CaptureGroupInfo[];
  /** Human hints about risky constructs (e.g. nested unbounded quantifiers). */
  warnings: string[];
}

interface Mode {
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
}

const CHAR_NAMES: Record<number, string> = {
  0: 'null character (NUL)',
  8: 'backspace',
  9: 'tab',
  10: 'line feed (newline)',
  11: 'vertical tab',
  12: 'form feed',
  13: 'carriage return',
  32: 'space',
  0xa0: 'no-break space',
  0x200b: 'zero-width space',
  0x2028: 'line separator',
  0x2029: 'paragraph separator',
  0xfeff: 'byte order mark',
};

export function codePointHex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Human label for a single code point, e.g. `"a"`, `tab`, `"é" (U+00E9)`. */
export function describeCodePoint(cp: number): string {
  const name = CHAR_NAMES[cp];
  if (name) return name;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return `control character ${codePointHex(cp)}`;
  if (cp >= 0xd800 && cp <= 0xdfff) return `lone surrogate ${codePointHex(cp)}`;
  const ch = String.fromCodePoint(cp);
  return cp > 0x7e ? `"${ch}" (${codePointHex(cp)})` : `"${ch}"`;
}

function charText(node: CharNode): string {
  const what = describeCodePoint(node.codePoint);
  switch (node.kind) {
    case 'control':
      return `Control character Ctrl+${node.raw.slice(2).toUpperCase()}: ${codePointHex(node.codePoint)}`;
    case 'hex':
      return `Character ${what}, written as a hex escape`;
    case 'unicode':
      return `Character ${what}, written as a Unicode escape`;
    case 'octal':
      return `Character ${what}, written as a legacy octal escape`;
    case 'identity':
      return `Literal ${what} (escaped)`;
    case 'escape':
      return `A ${what}`;
    default:
      return `Character ${what}`;
  }
}

const SHORTHAND: Record<ShorthandKind, string> = {
  d: 'A digit (0-9)',
  D: 'Any character that is not a digit',
  w: 'A word character: letter, digit or underscore [A-Za-z0-9_]',
  W: 'Any character that is not a word character',
  s: 'A whitespace character (space, tab, line break, no-break space, other Unicode spaces)',
  S: 'Any character that is not whitespace',
};

const GENERAL_CATEGORIES: Record<string, string> = {
  L: 'letter',
  Letter: 'letter',
  Lu: 'uppercase letter',
  Uppercase_Letter: 'uppercase letter',
  Ll: 'lowercase letter',
  Lowercase_Letter: 'lowercase letter',
  Lt: 'titlecase letter',
  Lm: 'modifier letter',
  Lo: 'other letter',
  M: 'combining mark',
  Mark: 'combining mark',
  Mn: 'non-spacing mark',
  N: 'number',
  Number: 'number',
  Nd: 'decimal digit',
  Decimal_Number: 'decimal digit',
  Nl: 'letter number',
  No: 'other number',
  P: 'punctuation character',
  Punctuation: 'punctuation character',
  S: 'symbol',
  Symbol: 'symbol',
  Sc: 'currency symbol',
  Sm: 'math symbol',
  Z: 'separator',
  Separator: 'separator',
  Zs: 'space separator',
  C: 'control or other character',
  Cc: 'control character',
  Cf: 'format character',
};

const BINARY_PROPS: Record<string, string> = {
  Emoji: 'emoji character',
  Emoji_Presentation: 'character shown as emoji by default',
  Extended_Pictographic: 'pictographic character (emoji and similar)',
  Alphabetic: 'alphabetic character',
  Alpha: 'alphabetic character',
  White_Space: 'whitespace character',
  Uppercase: 'uppercase character',
  Lowercase: 'lowercase character',
  ASCII: 'ASCII character',
  Any: 'any code point',
  ASCII_Hex_Digit: 'hexadecimal digit (0-9, A-F, a-f)',
  RGI_Emoji: 'recommended emoji (including multi-character sequences)',
  Basic_Emoji: 'basic emoji',
  Emoji_Keycap_Sequence: 'keycap emoji sequence',
  RGI_Emoji_Flag_Sequence: 'flag emoji',
};

function propertyText(node: PropertyNode): string {
  let what: string;
  if (node.value !== undefined) {
    const key = node.name;
    if (key === 'Script' || key === 'sc') what = `character in the ${node.value} script`;
    else if (key === 'Script_Extensions' || key === 'scx') what = `character used in the ${node.value} script`;
    else if (key === 'General_Category' || key === 'gc') what = `Unicode ${GENERAL_CATEGORIES[node.value] ?? node.value}`;
    else what = `character with ${key}=${node.value}`;
  } else {
    const gc = GENERAL_CATEGORIES[node.name];
    what = gc ? `Unicode ${gc}` : (BINARY_PROPS[node.name] ?? `character with the Unicode property ${node.name}`);
  }
  const a = article(what);
  return node.negated ? `Any character that is not ${a.toLowerCase()} ${what}` : `${a} ${what}`;
}

function article(phrase: string): 'A' | 'An' {
  return /^[aeio]|^u(?!ni)/i.test(phrase) ? 'An' : 'A';
}

export function quantifierPhrase(min: number, max: number, greedy: boolean): string {
  let count: string;
  if (min === 0 && max === 1) count = 'optional (0 or 1 time)';
  else if (min === 0 && max === Infinity) count = '0 or more times';
  else if (min === 1 && max === Infinity) count = '1 or more times';
  else if (max === Infinity) count = `${min} or more times`;
  else if (min === max) count = `exactly ${min} ${min === 1 ? 'time' : 'times'}`;
  else count = `between ${min} and ${max} times`;
  if (min === max) return count;
  return `${count}, ${greedy ? 'as many as possible (greedy)' : 'as few as possible (lazy)'}`;
}

const FLAG_NAMES: Record<string, string> = {
  i: 'ignore case',
  m: 'multiline: ^ and $ match at line breaks',
  s: 'dot matches line breaks',
};

class Explainer {
  readonly warnings: string[] = [];

  constructor(private readonly groups: CaptureGroupInfo[]) {}

  disjunction(node: DisjunctionNode, mode: Mode): ExplainNode[] {
    if (node.alternatives.length === 1) return this.alternative(node.alternatives[0], mode);
    const n = node.alternatives.length;
    return node.alternatives.map((alt, i) => ({
      raw: alt.raw,
      start: alt.start,
      end: alt.end,
      kind: 'alternation' as const,
      text: alt.terms.length
        ? `Alternative ${i + 1} of ${n}${i === 0 ? '' : ' (tried if the previous ones fail)'}`
        : `Alternative ${i + 1} of ${n}: matches the empty string`,
      children: alt.terms.length ? this.alternative(alt, mode) : undefined,
    }));
  }

  private alternative(alt: AlternativeNode, mode: Mode): ExplainNode[] {
    const out: ExplainNode[] = [];
    let run: CharNode[] = [];
    const flush = () => {
      if (run.length > 1) {
        const text = run.map((c) => String.fromCodePoint(c.codePoint)).join('');
        const printable = run.every((c) => c.codePoint >= 32 && c.codePoint !== 0x7f && !(c.codePoint >= 0xd800 && c.codePoint <= 0xdfff));
        out.push({
          raw: run.map((c) => c.raw).join(''),
          start: run[0].start,
          end: run[run.length - 1].end,
          kind: 'literal',
          text: printable
            ? `The text "${text}"${mode.ignoreCase ? ' (any letter case)' : ''}`
            : `The characters ${run.map((c) => describeCodePoint(c.codePoint)).join(', ')}`,
        });
      } else if (run.length === 1) {
        out.push(this.term(run[0], mode));
      }
      run = [];
    };
    for (const term of alt.terms) {
      if (term.type === 'char') {
        run.push(term);
        continue;
      }
      flush();
      out.push(this.term(term, mode));
    }
    flush();
    return out;
  }

  private term(node: TermNode, mode: Mode): ExplainNode {
    if (node.type !== 'quantifier') return this.atom(node, mode);
    const inner = this.atom(node.body, mode);
    if (node.max === Infinity && node.body.type === 'group' && containsUnbounded(node.body.body)) {
      this.warnings.push(
        `${node.raw} repeats a group that itself contains an unbounded repetition. On text that almost matches, this can take exponential time (catastrophic backtracking). Make the inner and outer repetitions unable to match the same text.`,
      );
    }
    return {
      ...inner,
      raw: node.raw,
      start: node.start,
      end: node.end,
      text: `${inner.text}, ${quantifierPhrase(node.min, node.max, node.greedy)}`,
    };
  }

  private atom(node: AtomNode, mode: Mode): ExplainNode {
    const base = { raw: node.raw, start: node.start, end: node.end };
    switch (node.type) {
      case 'char':
        return { ...base, kind: 'char', text: charText(node) + (mode.ignoreCase && /\p{L}/u.test(String.fromCodePoint(node.codePoint)) ? ' (any letter case)' : '') };
      case 'dot':
        return {
          ...base,
          kind: 'any',
          text: mode.dotAll ? 'Any single character, including line breaks' : 'Any single character except line breaks',
        };
      case 'anchor': {
        const text = {
          start: mode.multiline ? 'Start of a line' : 'Start of the text',
          end: mode.multiline ? 'End of a line' : 'End of the text',
          wordBoundary: 'Word boundary: between a word character and a non-word character',
          nonWordBoundary: 'Not a word boundary',
        }[node.kind];
        return { ...base, kind: 'anchor', text };
      }
      case 'shorthand':
        return { ...base, kind: 'class', text: SHORTHAND[node.kind] };
      case 'property':
        return { ...base, kind: 'class', text: propertyText(node) };
      case 'backreference': {
        const group =
          typeof node.ref === 'number' ? this.groups.find((g) => g.index === node.ref) : this.groups.find((g) => g.name === node.ref);
        const label =
          typeof node.ref === 'number'
            ? `group #${node.ref}${group?.name ? ` ("${group.name}")` : ''}`
            : `the group named "${node.ref}"${group ? ` (#${group.index})` : ''}`;
        return { ...base, kind: 'reference', text: `The same text that was captured by ${label}` };
      }
      case 'class':
        return this.charClass(node, mode);
      case 'lookaround': {
        const text = {
          lookahead: 'Lookahead: only if followed by',
          negativeLookahead: 'Negative lookahead: only if NOT followed by',
          lookbehind: 'Lookbehind: only if preceded by',
          negativeLookbehind: 'Negative lookbehind: only if NOT preceded by',
        }[node.kind];
        return { ...base, kind: 'lookaround', text: `${text} (matches no characters itself)`, children: this.disjunction(node.body, mode) };
      }
      case 'group': {
        let text: string;
        let inner = mode;
        if (node.kind === 'capture') {
          text = node.name ? `Named capture group "${node.name}" (#${node.index})` : `Capture group #${node.index}`;
        } else if (node.kind === 'noncapture') {
          text = 'Non-capturing group';
        } else {
          const parts: string[] = [];
          if (node.add) parts.push(`turn on ${[...node.add].map((f) => `${f} (${FLAG_NAMES[f]})`).join(', ')}`);
          if (node.remove) parts.push(`turn off ${[...node.remove].map((f) => `${f} (${FLAG_NAMES[f]})`).join(', ')}`);
          text = `Group with inline flags: ${parts.join('; ') || 'no change'}`;
          inner = { ...mode };
          for (const f of node.add ?? '') setFlag(inner, f, true);
          for (const f of node.remove ?? '') setFlag(inner, f, false);
        }
        const children = this.disjunction(node.body, inner);
        return { ...base, kind: 'group', text: children.length ? text : `${text}, empty`, children: children.length ? children : undefined };
      }
    }
  }

  private charClass(node: ClassNode, mode: Mode): ExplainNode {
    const base = { raw: node.raw, start: node.start, end: node.end };
    const children = node.items.map((item) => this.classItem(item, mode));
    let text: string;
    if (node.items.length === 0) {
      text = node.negated ? 'Any single character (an empty negated set)' : 'Nothing: an empty set never matches';
      return { ...base, kind: 'class', text };
    }
    if (node.operation === 'intersection') {
      text = node.negated ? 'One character that is NOT in all of these sets' : 'One character that is in all of these sets';
    } else if (node.operation === 'subtraction') {
      text = node.negated
        ? 'One character that is NOT in the first set minus the others'
        : 'One character from the first set, excluding the others';
    } else {
      text = node.negated ? 'One character NOT in the set' : 'One character from the set';
    }
    return { ...base, kind: 'class', text, children };
  }

  private classItem(item: ClassItem, mode: Mode): ExplainNode {
    const base = { raw: item.raw, start: item.start, end: item.end };
    switch (item.type) {
      case 'range':
        return {
          ...base,
          kind: 'class',
          text: `Range ${describeCodePoint(item.from.codePoint)} to ${describeCodePoint(item.to.codePoint)}${mode.ignoreCase ? ' (any letter case)' : ''}`,
        };
      case 'strings':
        return {
          ...base,
          kind: 'class',
          text: `One of the strings ${item.strings.map((s) => (s ? `"${s}"` : 'the empty string')).join(', ')}`,
        };
      case 'class':
        return this.charClass(item, mode);
      default:
        return this.atom(item, mode);
    }
  }
}

function setFlag(mode: Mode, flag: string, on: boolean) {
  if (flag === 'i') mode.ignoreCase = on;
  else if (flag === 'm') mode.multiline = on;
  else if (flag === 's') mode.dotAll = on;
}

/**
 * Heuristic for risky nesting: some alternative of the repeated group contains
 * an unbounded repetition and has no required literal character that separates
 * one iteration from the next. `(a+)+` and `(\w+\s?)*` qualify; the common,
 * safe `(?:\.[\w-]+)+` does not, because every iteration must start with ".".
 */
function containsUnbounded(node: DisjunctionNode): boolean {
  return node.alternatives.some((alt) => {
    const hasSeparator = alt.terms.some((t) => t.type === 'char' || (t.type === 'quantifier' && t.min >= 1 && t.body.type === 'char' && t.max !== Infinity));
    if (hasSeparator) return false;
    return alt.terms.some((t) => {
      if (t.type === 'quantifier' && t.max === Infinity) return true;
      const body = t.type === 'quantifier' ? t.body : t;
      return body.type === 'group' && containsUnbounded(body.body);
    });
  });
}

/** Explain a (valid) pattern token by token for the given flags. */
export function explainPattern(pattern: string, flags: string): Explanation {
  const unicodeSets = flags.includes('v');
  const unicode = unicodeSets || flags.includes('u');
  const { ast, groups } = parsePattern(pattern, { unicode, unicodeSets });
  const explainer = new Explainer(groups);
  const nodes = explainer.disjunction(ast, {
    ignoreCase: flags.includes('i'),
    multiline: flags.includes('m'),
    dotAll: flags.includes('s'),
    unicode,
  });
  return { nodes, groups, warnings: [...new Set(explainer.warnings)] };
}
