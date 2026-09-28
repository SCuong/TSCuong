/**
 * A small, lenient parser for JavaScript regular expression patterns, used to
 * explain a pattern token by token. It follows the ECMAScript grammar, including
 * the Annex B web-compat rules for patterns without the `u`/`v` flag, `v`-mode
 * class set operations, named groups and inline modifiers (`(?i:...)`).
 *
 * Validity is decided by the browser's own RegExp engine; this parser only has to
 * produce a faithful structure for patterns the engine accepts, and never throws.
 */

export interface ParseOptions {
  /** `u` or `v` flag: code-point semantics and strict syntax. */
  unicode?: boolean;
  /** `v` flag: class set operations, nested classes and `\q{...}`. */
  unicodeSets?: boolean;
}

interface Span {
  start: number;
  end: number;
  raw: string;
}

export type CharKind =
  | 'literal'
  | 'escape' // \n \t \r \f \v \0 and [\b]
  | 'hex' // \xHH
  | 'unicode' // \uHHHH, \u{H...}
  | 'control' // \cX
  | 'octal' // legacy \NNN (Annex B)
  | 'identity'; // \. \* etc.

export interface CharNode extends Span {
  type: 'char';
  kind: CharKind;
  /** The code point this token matches. */
  codePoint: number;
}

export interface DotNode extends Span {
  type: 'dot';
}

export type AnchorKind = 'start' | 'end' | 'wordBoundary' | 'nonWordBoundary';

export interface AnchorNode extends Span {
  type: 'anchor';
  kind: AnchorKind;
}

export type LookaroundKind = 'lookahead' | 'negativeLookahead' | 'lookbehind' | 'negativeLookbehind';

export interface LookaroundNode extends Span {
  type: 'lookaround';
  kind: LookaroundKind;
  body: DisjunctionNode;
}

export interface GroupNode extends Span {
  type: 'group';
  kind: 'capture' | 'noncapture' | 'modifiers';
  /** 1-based capture number (capture groups only). */
  index?: number;
  name?: string;
  /** Inline modifiers, e.g. `(?i-m:...)` → add "i", remove "m". */
  add?: string;
  remove?: string;
  body: DisjunctionNode;
}

export interface BackreferenceNode extends Span {
  type: 'backreference';
  ref: number | string;
}

export type ShorthandKind = 'd' | 'D' | 'w' | 'W' | 's' | 'S';

export interface ShorthandNode extends Span {
  type: 'shorthand';
  kind: ShorthandKind;
}

export interface PropertyNode extends Span {
  type: 'property';
  negated: boolean;
  /** e.g. "Script" in \p{Script=Greek}, or the lone name in \p{L}. */
  name: string;
  value?: string;
}

export interface RangeNode extends Span {
  type: 'range';
  from: CharNode;
  to: CharNode;
}

export interface StringsNode extends Span {
  type: 'strings';
  strings: string[];
}

export type ClassItem = CharNode | RangeNode | ShorthandNode | PropertyNode | ClassNode | StringsNode;

export interface ClassNode extends Span {
  type: 'class';
  negated: boolean;
  /** `v`-mode set operation between the operands; `union` otherwise. */
  operation: 'union' | 'intersection' | 'subtraction';
  items: ClassItem[];
}

export interface QuantifierNode extends Span {
  type: 'quantifier';
  min: number;
  /** `Infinity` when unbounded. */
  max: number;
  greedy: boolean;
  /** The quantifier text itself, e.g. "{2,5}?". */
  symbol: string;
  body: AtomNode;
}

export type AtomNode =
  | CharNode
  | DotNode
  | AnchorNode
  | LookaroundNode
  | GroupNode
  | BackreferenceNode
  | ShorthandNode
  | PropertyNode
  | ClassNode;

export type TermNode = AtomNode | QuantifierNode;

export interface AlternativeNode extends Span {
  type: 'alternative';
  terms: TermNode[];
}

export interface DisjunctionNode extends Span {
  type: 'disjunction';
  alternatives: AlternativeNode[];
}

export interface CaptureGroupInfo {
  index: number;
  name?: string;
  start: number;
  end: number;
}

export interface ParsedPattern {
  ast: DisjunctionNode;
  groups: CaptureGroupInfo[];
}

const V_RESERVED_PUNCT = '&-!#%,:;<=>@`~';

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isLetter = (c: string | undefined) => c !== undefined && /^[A-Za-z]$/.test(c);

/** Count capture groups the way the engine does (needed to resolve Annex B `\N` escapes). */
export function countCaptureGroups(pattern: string): { count: number; hasNamed: boolean } {
  let count = 0;
  let hasNamed = false;
  let inClass = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === '[') inClass++;
      else if (c === ']') inClass--;
      continue;
    }
    if (c === '[') inClass = 1;
    else if (c === '(') {
      if (pattern[i + 1] !== '?') count++;
      else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
        count++;
        hasNamed = true;
      }
    }
  }
  return { count, hasNamed };
}

class Parser {
  private pos = 0;
  private groupIndex = 0;
  readonly groups: CaptureGroupInfo[] = [];
  private readonly unicode: boolean;
  private readonly sets: boolean;
  private readonly totalGroups: number;
  private readonly namedGroups: boolean;

  constructor(
    private readonly src: string,
    options: ParseOptions,
  ) {
    this.sets = Boolean(options.unicodeSets);
    this.unicode = Boolean(options.unicode) || this.sets;
    const { count, hasNamed } = countCaptureGroups(src);
    this.totalGroups = count;
    this.namedGroups = this.unicode || hasNamed;
  }

  private peek(offset = 0): string | undefined {
    return this.src[this.pos + offset];
  }

  private span(start: number): Span {
    return { start, end: this.pos, raw: this.src.slice(start, this.pos) };
  }

  /** Read one source character (a whole code point in unicode mode). */
  private takeSourceChar(): number {
    const cp = this.unicode ? this.src.codePointAt(this.pos)! : this.src.charCodeAt(this.pos);
    this.pos += cp > 0xffff ? 2 : 1;
    return cp;
  }

  parseDisjunction(): DisjunctionNode {
    const start = this.pos;
    const alternatives: AlternativeNode[] = [this.parseAlternative()];
    while (this.peek() === '|') {
      this.pos++;
      alternatives.push(this.parseAlternative());
    }
    return { type: 'disjunction', alternatives, ...this.span(start) };
  }

  private parseAlternative(): AlternativeNode {
    const start = this.pos;
    const terms: TermNode[] = [];
    while (this.pos < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      terms.push(this.parseQuantifier(this.parseAtom()));
    }
    return { type: 'alternative', terms, ...this.span(start) };
  }

  /** Try to read `{n}`, `{n,}` or `{n,m}` at the current position without consuming on failure. */
  private readBraces(): { min: number; max: number } | null {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    const min = Number(m[1]);
    const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
    return { min, max };
  }

  private parseQuantifier(atom: AtomNode): TermNode {
    const qStart = this.pos;
    const c = this.peek();
    let min: number;
    let max: number;
    if (c === '*') {
      min = 0;
      max = Infinity;
      this.pos++;
    } else if (c === '+') {
      min = 1;
      max = Infinity;
      this.pos++;
    } else if (c === '?') {
      min = 0;
      max = 1;
      this.pos++;
    } else if (c === '{') {
      const braces = this.readBraces();
      if (!braces) return atom;
      ({ min, max } = braces);
    } else {
      return atom;
    }
    let greedy = true;
    if (this.peek() === '?') {
      greedy = false;
      this.pos++;
    }
    const symbol = this.src.slice(qStart, this.pos);
    return { type: 'quantifier', min, max, greedy, symbol, body: atom, ...this.span(atom.start) };
  }

  private parseAtom(): AtomNode {
    const start = this.pos;
    switch (this.peek()) {
      case '^':
        this.pos++;
        return { type: 'anchor', kind: 'start', ...this.span(start) };
      case '$':
        this.pos++;
        return { type: 'anchor', kind: 'end', ...this.span(start) };
      case '.':
        this.pos++;
        return { type: 'dot', ...this.span(start) };
      case '(':
        return this.parseGroup();
      case '[':
        return this.parseClass();
      case '\\':
        return this.parseAtomEscape();
      default: {
        const codePoint = this.takeSourceChar();
        return { type: 'char', kind: 'literal', codePoint, ...this.span(start) };
      }
    }
  }

  private closeGroup() {
    if (this.peek() === ')') this.pos++;
  }

  private parseGroup(): AtomNode {
    const start = this.pos;
    this.pos++; // (
    if (this.peek() !== '?') {
      const index = ++this.groupIndex;
      const info: CaptureGroupInfo = { index, start, end: start };
      this.groups.push(info);
      const body = this.parseDisjunction();
      this.closeGroup();
      info.end = this.pos;
      return { type: 'group', kind: 'capture', index, body, ...this.span(start) };
    }
    const next = this.peek(1);
    const next2 = this.peek(2);
    let lookKind: LookaroundKind | null = null;
    if (next === '=') lookKind = 'lookahead';
    else if (next === '!') lookKind = 'negativeLookahead';
    else if (next === '<' && next2 === '=') lookKind = 'lookbehind';
    else if (next === '<' && next2 === '!') lookKind = 'negativeLookbehind';
    if (lookKind) {
      this.pos += lookKind === 'lookbehind' || lookKind === 'negativeLookbehind' ? 3 : 2;
      const body = this.parseDisjunction();
      this.closeGroup();
      return { type: 'lookaround', kind: lookKind, body, ...this.span(start) };
    }
    if (next === ':') {
      this.pos += 2;
      const body = this.parseDisjunction();
      this.closeGroup();
      return { type: 'group', kind: 'noncapture', body, ...this.span(start) };
    }
    if (next === '<') {
      const m = /^\?<([^>]*)>/.exec(this.src.slice(this.pos));
      const name = m ? decodeGroupName(m[1]) : '';
      this.pos += m ? m[0].length : 2;
      const index = ++this.groupIndex;
      const info: CaptureGroupInfo = { index, name, start, end: start };
      this.groups.push(info);
      const body = this.parseDisjunction();
      this.closeGroup();
      info.end = this.pos;
      return { type: 'group', kind: 'capture', index, name, body, ...this.span(start) };
    }
    // Inline modifiers: (?ims-ims:...)
    const m = /^\?([ims]*)(?:-([ims]*))?:/.exec(this.src.slice(this.pos));
    if (m) {
      this.pos += m[0].length;
      const body = this.parseDisjunction();
      this.closeGroup();
      return { type: 'group', kind: 'modifiers', add: m[1], remove: m[2] ?? '', body, ...this.span(start) };
    }
    // Unknown group syntax (only reachable for patterns the engine rejects): treat "(" literally.
    return { type: 'char', kind: 'literal', codePoint: 40, ...this.span(start) };
  }

  private parseAtomEscape(): AtomNode {
    const start = this.pos;
    this.pos++; // backslash
    const c = this.peek();
    if (c === undefined) return { type: 'char', kind: 'identity', codePoint: 92, ...this.span(start) };
    if (c === 'b' || c === 'B') {
      this.pos++;
      return { type: 'anchor', kind: c === 'b' ? 'wordBoundary' : 'nonWordBoundary', ...this.span(start) };
    }
    if (isDigit(c) && c !== '0') {
      const digits = /^\d+/.exec(this.src.slice(this.pos))![0];
      const n = Number(digits);
      if (this.unicode || n <= this.totalGroups) {
        this.pos += digits.length;
        return { type: 'backreference', ref: n, ...this.span(start) };
      }
      // Annex B: not a valid back-reference → legacy octal or identity escape.
      return this.parseLegacyNumeric(start);
    }
    if (c === 'k' && this.namedGroups) {
      const m = /^k<([^>]*)>/.exec(this.src.slice(this.pos));
      if (m) {
        this.pos += m[0].length;
        return { type: 'backreference', ref: decodeGroupName(m[1]), ...this.span(start) };
      }
    }
    return this.parseSharedEscape(start, false);
  }

  /** `\0NN`, legacy octal (`\12`) or `\8`/`\9` in non-unicode patterns. */
  private parseLegacyNumeric(start: number): CharNode {
    const c = this.peek()!;
    if (c === '8' || c === '9') {
      this.pos++;
      return { type: 'char', kind: 'identity', codePoint: c.charCodeAt(0), ...this.span(start) };
    }
    let digits = '';
    while (digits.length < 3 && /^[0-7]$/.test(this.peek() ?? '')) {
      const candidate = digits + this.peek();
      if (parseInt(candidate, 8) > 0o377) break;
      digits = candidate;
      this.pos++;
    }
    return { type: 'char', kind: 'octal', codePoint: parseInt(digits, 8), ...this.span(start) };
  }

  /**
   * Escapes valid both outside and inside classes: shorthand classes, properties,
   * control/hex/unicode escapes, `\0` and identity escapes. `pos` is just after the backslash.
   */
  private parseSharedEscape(start: number, inClass: boolean): CharNode | ShorthandNode | PropertyNode {
    const c = this.peek()!;
    if ('dDwWsS'.includes(c)) {
      this.pos++;
      return { type: 'shorthand', kind: c as ShorthandKind, ...this.span(start) };
    }
    if ((c === 'p' || c === 'P') && this.unicode) {
      const m = /^[pP]\{([^}]*)\}/.exec(this.src.slice(this.pos));
      if (m) {
        this.pos += m[0].length;
        const [name, value] = m[1].split('=');
        return { type: 'property', negated: c === 'P', name, value, ...this.span(start) };
      }
    }
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, f: 12, v: 11 };
    if (c in simple) {
      this.pos++;
      return { type: 'char', kind: 'escape', codePoint: simple[c], ...this.span(start) };
    }
    if (c === 'c') {
      const letter = this.peek(1);
      if (isLetter(letter) || (inClass && !this.unicode && (isDigit(letter) || letter === '_'))) {
        this.pos += 2;
        return { type: 'char', kind: 'control', codePoint: letter!.charCodeAt(0) % 32, ...this.span(start) };
      }
      // Annex B: "\c" not followed by a letter is a literal backslash; "c" is read next.
      return { type: 'char', kind: 'literal', codePoint: 92, ...this.span(start) };
    }
    if (c === '0' && !isDigit(this.peek(1))) {
      this.pos++;
      return { type: 'char', kind: 'escape', codePoint: 0, ...this.span(start) };
    }
    if (isDigit(c) && !this.unicode) return this.parseLegacyNumeric(start);
    if (c === 'x' && isHex(this.peek(1)) && isHex(this.peek(2))) {
      this.pos += 3;
      return { type: 'char', kind: 'hex', codePoint: parseInt(this.src.slice(this.pos - 2, this.pos), 16), ...this.span(start) };
    }
    if (c === 'u') {
      const cp = this.readUnicodeEscape();
      if (cp !== null) return { type: 'char', kind: 'unicode', codePoint: cp, ...this.span(start) };
    }
    // Identity escape: the character itself.
    const codePoint = this.takeSourceChar();
    return { type: 'char', kind: 'identity', codePoint, ...this.span(start) };
  }

  /** Reads `uHHHH`, a surrogate pair `uHHHH\uHHHH` (unicode mode) or `u{H...}`; pos is at "u". */
  private readUnicodeEscape(): number | null {
    const rest = this.src.slice(this.pos);
    if (this.unicode) {
      const braced = /^u\{([0-9a-fA-F]+)\}/.exec(rest);
      if (braced) {
        this.pos += braced[0].length;
        return parseInt(braced[1], 16);
      }
      const pair = /^u(d[89ab][0-9a-f]{2})\\u(d[c-f][0-9a-f]{2})/i.exec(rest);
      if (pair) {
        this.pos += pair[0].length;
        const hi = parseInt(pair[1], 16);
        const lo = parseInt(pair[2], 16);
        return (hi - 0xd800) * 0x400 + (lo - 0xdc00) + 0x10000;
      }
    }
    const four = /^u([0-9a-fA-F]{4})/.exec(rest);
    if (four) {
      this.pos += 5;
      return parseInt(four[1], 16);
    }
    return null;
  }

  // ----------------------------------------------------------------- classes

  private parseClass(): ClassNode {
    const start = this.pos;
    this.pos++; // [
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos++;
    }
    const { items, operation } = this.sets ? this.parseClassSetContents() : this.parseClassRanges();
    if (this.peek() === ']') this.pos++;
    return { type: 'class', negated, operation, items, ...this.span(start) };
  }

  private parseClassRanges(): { items: ClassItem[]; operation: 'union' } {
    const items: ClassItem[] = [];
    while (this.pos < this.src.length && this.peek() !== ']') {
      const atom = this.parseClassAtom();
      if (atom.type === 'char' && this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        const save = this.pos;
        this.pos++; // -
        const to = this.parseClassAtom();
        if (to.type === 'char') {
          items.push({ type: 'range', from: atom, to, ...this.span(atom.start) });
          continue;
        }
        // Annex B: [a-\d] is "a", "-", \d.
        this.pos = save;
      }
      items.push(atom);
    }
    return { items, operation: 'union' };
  }

  private parseClassAtom(): CharNode | ShorthandNode | PropertyNode {
    const start = this.pos;
    if (this.peek() === '\\') {
      this.pos++;
      const c = this.peek();
      if (c === undefined) return { type: 'char', kind: 'identity', codePoint: 92, ...this.span(start) };
      if (c === 'b') {
        this.pos++;
        return { type: 'char', kind: 'escape', codePoint: 8, ...this.span(start) };
      }
      if (c === '-' && this.unicode) {
        this.pos++;
        return { type: 'char', kind: 'identity', codePoint: 45, ...this.span(start) };
      }
      return this.parseSharedEscape(start, true);
    }
    const codePoint = this.takeSourceChar();
    return { type: 'char', kind: 'literal', codePoint, ...this.span(start) };
  }

  /** `v`-mode ClassSetExpression: a union, or operands joined by `&&` or `--`. */
  private parseClassSetContents(): { items: ClassItem[]; operation: ClassNode['operation'] } {
    const items: ClassItem[] = [];
    let operation: ClassNode['operation'] = 'union';
    while (this.pos < this.src.length && this.peek() !== ']') {
      if (this.peek() === '&' && this.peek(1) === '&') {
        operation = 'intersection';
        this.pos += 2;
        continue;
      }
      if (this.peek() === '-' && this.peek(1) === '-') {
        operation = 'subtraction';
        this.pos += 2;
        continue;
      }
      const operand = this.parseClassSetOperand();
      if (operand.type === 'char' && this.peek() === '-' && this.peek(1) !== '-') {
        this.pos++;
        const to = this.parseClassSetOperand();
        if (to.type === 'char') {
          items.push({ type: 'range', from: operand, to, ...this.span(operand.start) });
          continue;
        }
        items.push(operand, to);
        continue;
      }
      items.push(operand);
    }
    return { items, operation };
  }

  private parseClassSetOperand(): ClassItem {
    const start = this.pos;
    const c = this.peek();
    if (c === '[') return this.parseClass();
    if (c === '\\') {
      this.pos++;
      const n = this.peek();
      if (n === undefined) return { type: 'char', kind: 'identity', codePoint: 92, ...this.span(start) };
      if (n === 'q' && this.peek(1) === '{') return this.parseClassStrings(start);
      if (n === 'b') {
        this.pos++;
        return { type: 'char', kind: 'escape', codePoint: 8, ...this.span(start) };
      }
      if (V_RESERVED_PUNCT.includes(n)) {
        this.pos++;
        return { type: 'char', kind: 'identity', codePoint: n.charCodeAt(0), ...this.span(start) };
      }
      return this.parseSharedEscape(start, true);
    }
    const codePoint = this.takeSourceChar();
    return { type: 'char', kind: 'literal', codePoint, ...this.span(start) };
  }

  /** `\q{abc|def}` in `v` mode; pos is at "q". */
  private parseClassStrings(start: number): StringsNode {
    this.pos += 2; // q{
    const strings: string[] = [];
    let current = '';
    while (this.pos < this.src.length && this.peek() !== '}') {
      if (this.peek() === '|') {
        strings.push(current);
        current = '';
        this.pos++;
        continue;
      }
      if (this.peek() === '\\') {
        const escStart = this.pos;
        this.pos++;
        const ch = this.parseSharedEscape(escStart, true);
        current += ch.type === 'char' ? String.fromCodePoint(ch.codePoint) : ch.raw;
        continue;
      }
      current += String.fromCodePoint(this.takeSourceChar());
    }
    strings.push(current);
    if (this.peek() === '}') this.pos++;
    return { type: 'strings', strings, ...this.span(start) };
  }
}

function decodeGroupName(raw: string): string {
  // Group names may contain \uXXXX / \u{...} escapes.
  return raw.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, braced: string | undefined, four: string) =>
    String.fromCodePoint(parseInt(braced ?? four, 16)),
  );
}

/**
 * Parse a pattern (the source between the slashes, without flags). Never throws.
 * Only call it for patterns the engine accepts: for invalid ones (e.g. a stray `)`)
 * the result covers the part that could be parsed.
 */
export function parsePattern(pattern: string, options: ParseOptions = {}): ParsedPattern {
  const parser = new Parser(pattern, options);
  const ast = parser.parseDisjunction();
  return { ast, groups: parser.groups };
}
