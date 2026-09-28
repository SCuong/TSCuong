import type { Plugin } from 'prettier';

export type PrettierParser =
  | 'html'
  | 'vue'
  | 'angular'
  | 'css'
  | 'scss'
  | 'less'
  | 'babel'
  | 'typescript'
  | 'json'
  | 'json5'
  | 'graphql';

export interface FormatOptions {
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  singleQuote: boolean;
  semi: boolean;
  trailingComma: 'all' | 'es5' | 'none';
  bracketSameLine: boolean;
}

export const DEFAULT_OPTIONS: FormatOptions = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  singleQuote: false,
  semi: true,
  trailingComma: 'all',
  bracketSameLine: false,
};

type PluginName = 'html' | 'postcss' | 'babel' | 'estree' | 'typescript' | 'graphql' | 'angular';

const loaders: Record<PluginName, () => Promise<Plugin>> = {
  html: () => import('prettier/plugins/html').then((m) => m.default ?? m),
  postcss: () => import('prettier/plugins/postcss').then((m) => m.default ?? m),
  babel: () => import('prettier/plugins/babel').then((m) => m.default ?? m),
  estree: () => import('prettier/plugins/estree').then((m) => (m.default ?? m) as Plugin),
  typescript: () => import('prettier/plugins/typescript').then((m) => m.default ?? m),
  graphql: () => import('prettier/plugins/graphql').then((m) => m.default ?? m),
  angular: () => import('prettier/plugins/angular').then((m) => m.default ?? m),
};

const PLUGINS_FOR: Record<PrettierParser, PluginName[]> = {
  html: ['html', 'postcss', 'babel', 'estree'],
  vue: ['html', 'postcss', 'babel', 'estree', 'typescript'],
  angular: ['html', 'angular', 'postcss', 'babel', 'estree'],
  css: ['postcss'],
  scss: ['postcss'],
  less: ['postcss'],
  babel: ['babel', 'estree'],
  typescript: ['typescript', 'estree'],
  json: ['babel', 'estree'],
  json5: ['babel', 'estree'],
  graphql: ['graphql'],
};

const cache = new Map<PluginName, Promise<Plugin>>();
function load(name: PluginName): Promise<Plugin> {
  let p = cache.get(name);
  if (!p) {
    p = loaders[name]();
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p;
}

/** Formats code with Prettier (standalone build, plugins loaded on demand). */
export async function formatCode(code: string, parser: PrettierParser, options: FormatOptions): Promise<string> {
  const [{ format }, plugins] = await Promise.all([import('prettier/standalone'), Promise.all(PLUGINS_FOR[parser].map(load))]);
  return format(code, {
    parser,
    plugins,
    printWidth: options.printWidth,
    tabWidth: options.tabWidth,
    useTabs: options.useTabs,
    singleQuote: options.singleQuote,
    jsxSingleQuote: false,
    semi: options.semi,
    trailingComma: options.trailingComma,
    bracketSameLine: options.bracketSameLine,
    // HTML: respect CSS display so inline elements keep their whitespace semantics.
    htmlWhitespaceSensitivity: 'css',
  });
}

export interface FormatError {
  message: string;
  line: number | null;
  column: number | null;
  frame: string | null;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** Turns a Prettier error into a short sentence plus an optional code frame. */
export function describeFormatError(error: unknown): FormatError {
  const raw = (error instanceof Error ? error.message : String(error)).replace(ANSI, '');
  const loc = (error as { loc?: { start?: { line?: number; column?: number } } } | null)?.loc?.start;
  const lines = raw.split('\n');
  const first = lines[0].trim();
  const frameLines = lines.slice(1).filter((l) => /^\s*(>?\s*\d+\s*\||\s*\|)/.test(l));
  let line = loc?.line ?? null;
  let column = loc?.column ?? null;
  const m = /\((\d+):(\d+)\)\s*$/.exec(first);
  if (m && line === null) {
    line = Number(m[1]);
    column = Number(m[2]);
  }
  let message = first.replace(/\s*\(\d+:\d+\)\s*$/, '').replace(/^SyntaxError:\s*/, '');
  if (!message) message = 'The code could not be parsed.';
  message = message.charAt(0).toUpperCase() + message.slice(1);
  if (!/[.!?]$/.test(message)) message += '.';
  return { message, line, column, frame: frameLines.length ? frameLines.join('\n') : null };
}

export function formatErrorText(e: FormatError): string {
  return e.line !== null ? `Line ${e.line}, column ${e.column ?? 1}: ${e.message}` : e.message;
}
