import { Language, LanguageSupport, StreamLanguage, type StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import type { Parser } from '@lezer/common';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { loadLanguage } from '@/components/editor/languages';
import { getSnippetLanguage, type LegacyMode } from './languages';

export interface LoadedLanguage {
  /** Extension to pass to CodeEditor via `extensions` (legacy modes only). */
  extension: Extension;
  parser: Parser | null;
}

async function legacyParser(mode: LegacyMode): Promise<StreamParser<unknown>> {
  switch (mode) {
    case 'kotlin':
      return (await import('@codemirror/legacy-modes/mode/clike')).kotlin;
    case 'csharp':
      return (await import('@codemirror/legacy-modes/mode/clike')).csharp;
    case 'scala':
      return (await import('@codemirror/legacy-modes/mode/clike')).scala;
    case 'dart':
      return (await import('@codemirror/legacy-modes/mode/clike')).dart;
    case 'objectiveC':
      return (await import('@codemirror/legacy-modes/mode/clike')).objectiveC;
    case 'ruby':
      return (await import('@codemirror/legacy-modes/mode/ruby')).ruby;
    case 'swift':
      return (await import('@codemirror/legacy-modes/mode/swift')).swift;
    case 'lua':
      return (await import('@codemirror/legacy-modes/mode/lua')).lua;
    case 'perl':
      return (await import('@codemirror/legacy-modes/mode/perl')).perl;
    case 'r':
      return (await import('@codemirror/legacy-modes/mode/r')).r;
    case 'haskell':
      return (await import('@codemirror/legacy-modes/mode/haskell')).haskell;
    case 'powershell':
      return (await import('@codemirror/legacy-modes/mode/powershell')).powerShell;
    case 'dockerfile':
      return (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile;
    case 'nginx':
      return (await import('@codemirror/legacy-modes/mode/nginx')).nginx;
    case 'properties':
      return (await import('@codemirror/legacy-modes/mode/properties')).properties;
    case 'protobuf':
      return (await import('@codemirror/legacy-modes/mode/protobuf')).protobuf;
    case 'cmake':
      return (await import('@codemirror/legacy-modes/mode/cmake')).cmake;
    case 'erlang':
      return (await import('@codemirror/legacy-modes/mode/erlang')).erlang;
    case 'julia':
      return (await import('@codemirror/legacy-modes/mode/julia')).julia;
    case 'groovy':
      return (await import('@codemirror/legacy-modes/mode/groovy')).groovy;
    case 'clojure':
      return (await import('@codemirror/legacy-modes/mode/clojure')).clojure;
    case 'fsharp':
      return (await import('@codemirror/legacy-modes/mode/mllike')).fSharp;
    case 'ocaml':
      return (await import('@codemirror/legacy-modes/mode/mllike')).oCaml;
    case 'scss':
      return (await import('@codemirror/legacy-modes/mode/css')).sCSS;
    case 'less':
      return (await import('@codemirror/legacy-modes/mode/css')).less;
    case 'latex':
      return (await import('@codemirror/legacy-modes/mode/stex')).stex;
    case 'elm':
      return (await import('@codemirror/legacy-modes/mode/elm')).elm;
    case 'vb':
      return (await import('@codemirror/legacy-modes/mode/vb')).vb;
  }
}

function parserOf(ext: Extension): Parser | null {
  if (ext instanceof LanguageSupport) return ext.language.parser;
  if (ext instanceof Language) return ext.parser;
  return null;
}

const cache = new Map<string, Promise<LoadedLanguage>>();
const resolved = new Map<string, LoadedLanguage>();
const EMPTY: LoadedLanguage = { extension: [], parser: null };

/** Lazily loads editor + static highlighting support for a snippet language. Never rejects. */
export function loadSnippetLanguage(languageId: string): Promise<LoadedLanguage> {
  const lang = getSnippetLanguage(languageId);
  let pending = cache.get(lang.id);
  if (!pending) {
    pending = (async (): Promise<LoadedLanguage> => {
      if (lang.editor) {
        const ext = await loadLanguage(lang.editor);
        return { extension: [], parser: parserOf(ext) };
      }
      if (lang.legacy) {
        const language = StreamLanguage.define(await legacyParser(lang.legacy));
        return { extension: language, parser: language.parser };
      }
      return EMPTY;
    })()
      .catch(() => EMPTY)
      .then((value) => {
        resolved.set(lang.id, value);
        return value;
      });
    cache.set(lang.id, pending);
  }
  return pending;
}

/** Synchronous access to an already loaded language (avoids a flash of unhighlighted code). */
export function loadedSnippetLanguage(languageId: string): LoadedLanguage | undefined {
  return resolved.get(getSnippetLanguage(languageId).id);
}

export interface Token {
  text: string;
  /** Space separated `tok-*` classes, or '' for plain text. */
  cls: string;
}

/** Split code into highlighted tokens using lezer's classHighlighter. Returns one plain token without a parser. */
export function highlightCode(code: string, parser: Parser | null): Token[] {
  if (!code) return [];
  if (!parser) return [{ text: code, cls: '' }];
  const tokens: Token[] = [];
  let pos = 0;
  try {
    const tree = parser.parse(code);
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > pos) tokens.push({ text: code.slice(pos, from), cls: '' });
      tokens.push({ text: code.slice(from, to), cls: classes });
      pos = to;
    });
  } catch {
    return [{ text: code, cls: '' }];
  }
  if (pos < code.length) tokens.push({ text: code.slice(pos), cls: '' });
  return tokens;
}

/** Split tokens into lines (tokens spanning newlines are cut), for rendering with line numbers. */
export function tokensToLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, cls: token.cls });
    });
  }
  return lines;
}

/** First `maxLines` lines of code, for list previews. */
export function previewLines(code: string, maxLines: number, maxChars = 400): string {
  let end = 0;
  let lines = 0;
  while (end < code.length && lines < maxLines) {
    const nl = code.indexOf('\n', end);
    if (nl === -1) {
      end = code.length;
      break;
    }
    end = nl + 1;
    lines++;
  }
  return code.slice(0, Math.min(end, maxChars)).replace(/\n+$/, '');
}
