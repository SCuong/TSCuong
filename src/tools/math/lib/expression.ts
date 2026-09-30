/**
 * A small, safe arithmetic expression language (no eval / new Function).
 *
 * Grammar (lowest to highest precedence):
 *   statement  := IDENT '=' expr | expr
 *   additive   := multiplicative (('+' | '-') multiplicative)*
 *   multiplic. := unary (('*' | '/' | '%' | implicit) unary)*     % is the remainder (modulo) operator
 *   unary      := ('-' | '+') unary | power
 *   power      := postfix ('^' unary)?                           right-associative, so 2^3^2 = 2^9 and -2^2 = -4
 *   postfix    := primary '!'*
 *   primary    := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'
 *
 * Implicit multiplication is supported between a value and a following name or
 * parenthesis: `2pi`, `3(4 + 1)`, `(1 + 2)(3 + 4)`, `2 sqrt(9)`.
 */

export class ExpressionError extends Error {
  /** 0-based character offset inside the source line. */
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
  }
}

type TokenType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'assign' | 'eof';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const OPERATOR_ALIASES: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-', '**': '^' };

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < src.length && /[0-9_]/.test(src[i])) i++;
      if (src[i] === '.') {
        i++;
        while (i < src.length && /[0-9_]/.test(src[i])) i++;
      }
      // Exponent only when digits follow, so `2e` stays "2 × e".
      if ((src[i] === 'e' || src[i] === 'E') && /^[eE][+-]?[0-9]/.test(src.slice(i, i + 3))) {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < src.length && /[0-9]/.test(src[i])) i++;
      }
      const text = src.slice(start, i);
      if (text === '.' || /\.\d*\./.test(text) || src[i] === '.') {
        throw new ExpressionError(`Malformed number at column ${start + 1}`, start);
      }
      if (/_$|_\.|\._/.test(text) || text.startsWith('_')) {
        throw new ExpressionError(`Malformed number at column ${start + 1}`, start);
      }
      tokens.push({ type: 'num', value: text.replace(/_/g, ''), pos: start });
      continue;
    }
    if (/[A-Za-z_π]/.test(ch)) {
      const start = i;
      i++;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }
    if (ch === '*' && src[i + 1] === '*') {
      tokens.push({ type: 'op', value: '^', pos: i });
      i += 2;
      continue;
    }
    if ('+-*/^%!'.includes(ch) || ch in OPERATOR_ALIASES) {
      tokens.push({ type: 'op', value: OPERATOR_ALIASES[ch] ?? ch, pos: i });
      i++;
      continue;
    }
    if (ch === '(') tokens.push({ type: 'lparen', value: ch, pos: i });
    else if (ch === ')') tokens.push({ type: 'rparen', value: ch, pos: i });
    else if (ch === ',' || ch === ';') tokens.push({ type: 'comma', value: ch, pos: i });
    else if (ch === '=') tokens.push({ type: 'assign', value: ch, pos: i });
    else throw new ExpressionError(`Unexpected character '${ch}' at column ${i + 1}`, i);
    i++;
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

export type Node =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'unary'; op: '-' | '+'; arg: Node; pos: number }
  | { kind: 'postfix'; op: '!'; arg: Node; pos: number }
  | { kind: 'binary'; op: string; left: Node; right: Node; pos: number }
  | { kind: 'call'; name: string; args: Node[]; pos: number };

export type Statement = { kind: 'assign'; name: string; expr: Node; pos: number } | { kind: 'expr'; expr: Node };

function describeToken(t: Token): string {
  if (t.type === 'eof') return 'end of input';
  if (t.type === 'num') return `number '${t.value}'`;
  if (t.type === 'ident') return `name '${t.value}'`;
  return `'${t.value}'`;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private unexpected(t: Token): never {
    if (t.type === 'eof') throw new ExpressionError(`Unexpected end of expression at column ${t.pos + 1}`, t.pos);
    throw new ExpressionError(`Unexpected ${describeToken(t)} at column ${t.pos + 1}`, t.pos);
  }

  parseStatement(): Statement {
    const first = this.peek();
    if (first.type === 'eof') throw new ExpressionError('Empty expression', 0);
    let stmt: Statement;
    if (first.type === 'ident' && this.tokens[this.i + 1]?.type === 'assign') {
      this.i += 2;
      if (RESERVED.has(first.value)) {
        throw new ExpressionError(`'${first.value}' is a built-in name and cannot be assigned`, first.pos);
      }
      stmt = { kind: 'assign', name: first.value, expr: this.parseAdditive(), pos: first.pos };
    } else {
      stmt = { kind: 'expr', expr: this.parseAdditive() };
    }
    const end = this.peek();
    if (end.type === 'rparen') throw new ExpressionError(`Unmatched ')' at column ${end.pos + 1}`, end.pos);
    if (end.type === 'assign') {
      throw new ExpressionError(`Unexpected '=' at column ${end.pos + 1} (assign with "name = expression")`, end.pos);
    }
    if (end.type !== 'eof') this.unexpected(end);
    return stmt;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next();
        left = { kind: 'binary', op: t.value, left, right: this.parseMultiplicative(), pos: t.pos };
      } else return left;
    }
  }

  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.next();
        left = { kind: 'binary', op: t.value, left, right: this.parseUnary(), pos: t.pos };
      } else if (t.type === 'ident' || t.type === 'lparen') {
        // Implicit multiplication: 2pi, 3(4), (1)(2), 2 sqrt(4)
        left = { kind: 'binary', op: '*', left, right: this.parseUnary(), pos: t.pos };
      } else return left;
    }
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next();
      return { kind: 'unary', op: t.value, arg: this.parseUnary(), pos: t.pos };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePostfix();
    const t = this.peek();
    if (t.type === 'op' && t.value === '^') {
      this.next();
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary(), pos: t.pos };
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    while (this.peek().type === 'op' && this.peek().value === '!') {
      const t = this.next();
      node = { kind: 'postfix', op: '!', arg: node, pos: t.pos };
    }
    return node;
  }

  private parsePrimary(): Node {
    const t = this.next();
    if (t.type === 'num') {
      const value = Number(t.value);
      if (!Number.isFinite(value)) throw new ExpressionError(`Number '${t.value}' is too large`, t.pos);
      return { kind: 'num', value, pos: t.pos };
    }
    if (t.type === 'ident') {
      if (this.peek().type === 'lparen') {
        const open = this.next();
        const args: Node[] = [];
        if (this.peek().type !== 'rparen') {
          for (;;) {
            args.push(this.parseAdditive());
            const sep = this.peek();
            if (sep.type === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.next();
        if (close.type !== 'rparen') {
          if (close.type === 'eof') {
            throw new ExpressionError(`Missing ')' to close '${t.value}(' opened at column ${open.pos + 1}`, open.pos);
          }
          this.unexpected(close);
        }
        return { kind: 'call', name: t.value, args, pos: t.pos };
      }
      return { kind: 'var', name: t.value, pos: t.pos };
    }
    if (t.type === 'lparen') {
      if (this.peek().type === 'rparen') {
        const r = this.peek();
        throw new ExpressionError(`Empty parentheses at column ${t.pos + 1}`, r.pos);
      }
      const inner = this.parseAdditive();
      const close = this.next();
      if (close.type !== 'rparen') {
        if (close.type === 'eof') throw new ExpressionError(`Missing ')' for '(' at column ${t.pos + 1}`, t.pos);
        this.unexpected(close);
      }
      return inner;
    }
    if (t.type === 'rparen') throw new ExpressionError(`Unexpected ')' at column ${t.pos + 1}`, t.pos);
    return this.unexpected(t);
  }
}

export function parseStatement(src: string): Statement {
  try {
    return new Parser(tokenize(src)).parseStatement();
  } catch (error) {
    if (error instanceof RangeError) throw new ExpressionError('Expression is nested too deeply', 0);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type AngleMode = 'rad' | 'deg';

export const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
};

interface FnSpec {
  min: number;
  max: number;
  fn: (args: number[], mode: AngleMode, pos: number) => number;
}

const toRad = (x: number, mode: AngleMode) => (mode === 'deg' ? (x * Math.PI) / 180 : x);
const fromRad = (x: number, mode: AngleMode) => (mode === 'deg' ? (x * 180) / Math.PI : x);

/** sin/cos of exact multiples of 90° should be exactly 0/±1 in degree mode. */
function trig(kind: 'sin' | 'cos' | 'tan', x: number, mode: AngleMode, pos: number): number {
  if (mode === 'deg') {
    const r = ((x % 360) + 360) % 360;
    if (Number.isInteger(r) && r % 90 === 0) {
      const quarter = r / 90;
      const sin = [0, 1, 0, -1][quarter];
      const cos = [1, 0, -1, 0][quarter];
      if (kind === 'sin') return sin;
      if (kind === 'cos') return cos;
      if (cos === 0) throw new ExpressionError(`tan(${x}°) is undefined`, pos);
      return sin / cos;
    }
  }
  const rad = toRad(x, mode);
  return kind === 'sin' ? Math.sin(rad) : kind === 'cos' ? Math.cos(rad) : Math.tan(rad);
}

function domain(ok: boolean, message: string, pos: number) {
  if (!ok) throw new ExpressionError(message, pos);
}

function factorial(n: number, pos: number): number {
  domain(Number.isInteger(n) && n >= 0, 'Factorial is only defined for non-negative whole numbers', pos);
  domain(n <= 170, 'Factorial is too large (maximum is 170!)', pos);
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

export const FUNCTIONS: Record<string, FnSpec> = {
  sin: { min: 1, max: 1, fn: ([x], m, p) => trig('sin', x, m, p) },
  cos: { min: 1, max: 1, fn: ([x], m, p) => trig('cos', x, m, p) },
  tan: { min: 1, max: 1, fn: ([x], m, p) => trig('tan', x, m, p) },
  asin: {
    min: 1,
    max: 1,
    fn: ([x], m, p) => (domain(x >= -1 && x <= 1, 'asin() needs a value between -1 and 1', p), fromRad(Math.asin(x), m)),
  },
  acos: {
    min: 1,
    max: 1,
    fn: ([x], m, p) => (domain(x >= -1 && x <= 1, 'acos() needs a value between -1 and 1', p), fromRad(Math.acos(x), m)),
  },
  atan: { min: 1, max: 1, fn: ([x], m) => fromRad(Math.atan(x), m) },
  atan2: { min: 2, max: 2, fn: ([y, x], m) => fromRad(Math.atan2(y, x), m) },
  sinh: { min: 1, max: 1, fn: ([x]) => Math.sinh(x) },
  cosh: { min: 1, max: 1, fn: ([x]) => Math.cosh(x) },
  tanh: { min: 1, max: 1, fn: ([x]) => Math.tanh(x) },
  sqrt: {
    min: 1,
    max: 1,
    fn: ([x], _m, p) => (domain(x >= 0, 'sqrt() of a negative number is not a real number', p), Math.sqrt(x)),
  },
  cbrt: { min: 1, max: 1, fn: ([x]) => Math.cbrt(x) },
  log: {
    min: 1,
    max: 2,
    fn: ([x, base], _m, p) => {
      domain(x > 0, 'log() is only defined for positive numbers', p);
      if (base === undefined) return Math.log10(x);
      domain(base > 0 && base !== 1, 'log() base must be positive and not 1', p);
      return Math.log(x) / Math.log(base);
    },
  },
  ln: { min: 1, max: 1, fn: ([x], _m, p) => (domain(x > 0, 'ln() is only defined for positive numbers', p), Math.log(x)) },
  log2: {
    min: 1,
    max: 1,
    fn: ([x], _m, p) => (domain(x > 0, 'log2() is only defined for positive numbers', p), Math.log2(x)),
  },
  log10: {
    min: 1,
    max: 1,
    fn: ([x], _m, p) => (domain(x > 0, 'log10() is only defined for positive numbers', p), Math.log10(x)),
  },
  exp: { min: 1, max: 1, fn: ([x]) => Math.exp(x) },
  abs: { min: 1, max: 1, fn: ([x]) => Math.abs(x) },
  sign: { min: 1, max: 1, fn: ([x]) => Math.sign(x) },
  round: {
    min: 1,
    max: 2,
    fn: ([x, digits], _m, p) => {
      if (digits === undefined) return Math.round(x);
      domain(Number.isInteger(digits) && digits >= 0 && digits <= 15, 'round() digits must be a whole number 0–15', p);
      const f = 10 ** digits;
      return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
    },
  },
  floor: { min: 1, max: 1, fn: ([x]) => Math.floor(x) },
  ceil: { min: 1, max: 1, fn: ([x]) => Math.ceil(x) },
  trunc: { min: 1, max: 1, fn: ([x]) => Math.trunc(x) },
  min: { min: 1, max: Infinity, fn: (args) => Math.min(...args) },
  max: { min: 1, max: Infinity, fn: (args) => Math.max(...args) },
  pow: { min: 2, max: 2, fn: ([a, b], _m, p) => power(a, b, p) },
  hypot: { min: 1, max: Infinity, fn: (args) => Math.hypot(...args) },
  mod: { min: 2, max: 2, fn: ([a, b], _m, p) => remainder(a, b, p) },
  fact: { min: 1, max: 1, fn: ([x], _m, p) => factorial(x, p) },
};

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const RESERVED = new Set([...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS)]);

function power(a: number, b: number, pos: number): number {
  domain(!(a === 0 && b < 0), 'Division by zero (0 raised to a negative power)', pos);
  domain(!(a < 0 && !Number.isInteger(b)), 'A negative number to a fractional power is not a real number', pos);
  return a ** b;
}

function remainder(a: number, b: number, pos: number): number {
  domain(b !== 0, 'Division by zero (remainder of x % 0)', pos);
  return a % b;
}

function applyBinary(op: string, a: number, b: number, pos: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) throw new ExpressionError(`Division by zero at column ${pos + 1}`, pos);
      return a / b;
    case '%':
      return remainder(a, b, pos);
    case '^':
      return power(a, b, pos);
  }
  throw new ExpressionError(`Unknown operator '${op}'`, pos);
}

export interface EvalOptions {
  angleMode?: AngleMode;
}

export function evaluateNode(node: Node, vars: ReadonlyMap<string, number>, opts: EvalOptions = {}): number {
  const mode = opts.angleMode ?? 'rad';
  let depth = 0;
  const ev = (n: Node): number => {
    if (++depth > 100_000) throw new ExpressionError('Expression is nested too deeply', n.pos);
    try {
      switch (n.kind) {
        case 'num':
          return n.value;
        case 'var': {
          if (vars.has(n.name)) return vars.get(n.name)!;
          if (hasOwn(CONSTANTS, n.name)) return CONSTANTS[n.name];
          if (hasOwn(FUNCTIONS, n.name)) throw new ExpressionError(`'${n.name}' is a function; call it like ${n.name}(x)`, n.pos);
          throw new ExpressionError(`Undefined variable '${n.name}' at column ${n.pos + 1}`, n.pos);
        }
        case 'unary': {
          const v = ev(n.arg);
          return n.op === '-' ? -v : v;
        }
        case 'postfix':
          return factorial(ev(n.arg), n.pos);
        case 'binary': {
          // Walk the left spine iteratively so long chains like 1+1+…+1 don't exhaust the stack.
          const spine: Array<Extract<Node, { kind: 'binary' }>> = [];
          let cur: Node = n;
          while (cur.kind === 'binary') {
            spine.push(cur);
            cur = cur.left;
          }
          let acc = ev(cur);
          for (let k = spine.length - 1; k >= 0; k--) {
            const b = spine[k];
            acc = applyBinary(b.op, acc, ev(b.right), b.pos);
          }
          return acc;
        }
        case 'call': {
          const spec = hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
          if (!spec) {
            if (vars.has(n.name) || hasOwn(CONSTANTS, n.name)) {
              // `x(2)` where x is a value: treat as implicit multiplication.
              const v = vars.has(n.name) ? vars.get(n.name)! : CONSTANTS[n.name];
              if (n.args.length !== 1) throw new ExpressionError(`'${n.name}' is not a function`, n.pos);
              return v * ev(n.args[0]);
            }
            throw new ExpressionError(`Unknown function '${n.name}' at column ${n.pos + 1}`, n.pos);
          }
          if (n.args.length < spec.min || n.args.length > spec.max) {
            const expected =
              spec.min === spec.max
                ? `${spec.min} argument${spec.min === 1 ? '' : 's'}`
                : spec.max === Infinity
                  ? `at least ${spec.min} argument${spec.min === 1 ? '' : 's'}`
                  : `${spec.min} to ${spec.max} arguments`;
            throw new ExpressionError(`${n.name}() expects ${expected}, got ${n.args.length}`, n.pos);
          }
          return spec.fn(n.args.map(ev), mode, n.pos);
        }
      }
    } finally {
      depth--;
    }
  };
  let result: number;
  try {
    result = ev(node);
  } catch (error) {
    if (error instanceof RangeError) throw new ExpressionError('Expression is too complex to evaluate', node.pos);
    throw error;
  }
  if (Number.isNaN(result)) throw new ExpressionError('The result is not a real number', node.pos);
  if (!Number.isFinite(result)) throw new ExpressionError('The result is too large to represent', node.pos);
  return result;
}

/** Largest magnitude up to which every whole number is exactly representable as a double. */
const EXACT_INTEGER_LIMIT = 2 ** 53;

/**
 * Display a double without binary floating-point noise (0.1 + 0.2 → 0.3) and without inventing digits:
 * - whole numbers up to 2^53 are exact and shown in full;
 * - other values keep `significant` digits, but never round away digits of the integer part
 *   (123456789012.25 stays 123456789012.25 instead of becoming 123456789012);
 * - magnitudes from 1e15 up (where doubles no longer hold every digit, e.g. 2^64) and tiny ones use
 *   scientific notation, so the display never shows made-up trailing digits such as 18446744073709552000.
 */
export function formatResult(value: number, significant = 12): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (Number.isInteger(value) && abs <= EXACT_INTEGER_LIMIT) return value.toString();
  if (abs >= 1e15 || abs < 1e-9) {
    const [mantissa, exp] = value.toExponential(significant - 1).split('e');
    return `${mantissa.replace(/\.?0+$/, '')}e${exp}`;
  }
  // Keep every integer digit plus two decimals, capped at the ~15 digits a double reliably holds.
  const intDigits = abs >= 1 ? String(Math.trunc(abs)).length : 0;
  const digits = Math.min(15, Math.max(significant, intDigits + 2));
  const rounded = Number(value.toPrecision(digits));
  return Object.is(rounded, -0) ? '0' : rounded.toString();
}

export interface LineResult {
  /** 0-based line index in the program text. */
  line: number;
  source: string;
  value?: number;
  formatted?: string;
  assigned?: string;
  error?: { message: string; position: number };
}

export interface ProgramResult {
  lines: LineResult[];
  vars: Map<string, number>;
  last?: number;
}

/**
 * Evaluate each non-empty line in order. Lines may assign variables (`x = 3`)
 * and `ans` always holds the previous successful result. `#` starts a comment.
 */
export function evaluateProgram(
  text: string,
  opts: EvalOptions = {},
  initialVars: Iterable<[string, number]> = [],
): ProgramResult {
  const vars = new Map<string, number>(initialVars);
  const lines: LineResult[] = [];
  let last: number | undefined = vars.get('ans');
  text.split(/\r?\n/).forEach((raw, index) => {
    const hash = raw.indexOf('#');
    const source = hash >= 0 ? raw.slice(0, hash) : raw;
    if (!source.trim()) return;
    try {
      const stmt = parseStatement(source);
      if (stmt.kind === 'assign') {
        if (stmt.name === 'ans') throw new ExpressionError("'ans' holds the previous result and cannot be assigned", stmt.pos);
        const value = evaluateNode(stmt.expr, vars, opts);
        vars.set(stmt.name, value);
        last = value;
        vars.set('ans', value);
        lines.push({ line: index, source, value, formatted: formatResult(value), assigned: stmt.name });
      } else {
        const value = evaluateNode(stmt.expr, vars, opts);
        last = value;
        vars.set('ans', value);
        lines.push({ line: index, source, value, formatted: formatResult(value) });
      }
    } catch (error) {
      if (error instanceof ExpressionError) {
        lines.push({ line: index, source, error: { message: error.message, position: error.position } });
      } else {
        throw error;
      }
    }
  });
  return { lines, vars, last };
}

/** Convenience: evaluate a single expression and return its number (throws ExpressionError). */
export function evaluate(expr: string, vars: Record<string, number> = {}, opts: EvalOptions = {}): number {
  const stmt = parseStatement(expr);
  const env = new Map(Object.entries(vars));
  return evaluateNode(stmt.kind === 'assign' ? stmt.expr : stmt.expr, env, opts);
}
