import type { EditorLanguage } from '@/components/editor/languages';

/**
 * Languages a snippet can be tagged with. `editor` maps to the shared CodeEditor
 * language support; `legacy` names a CodeMirror legacy-mode stream parser used
 * when the shared editor has no dedicated support. Languages with neither are
 * edited and shown as plain text.
 */
export interface SnippetLanguage {
  id: string;
  name: string;
  /** File extension for "download as file" (without the dot), or a full file name when `fileName` is set. */
  ext: string;
  /** Use this exact file name instead of `<title>.<ext>` (e.g. Dockerfile, Makefile). */
  fileName?: string;
  editor?: EditorLanguage;
  legacy?: LegacyMode;
  /** Extra names people use, for import normalization and search. */
  aliases?: string[];
}

export type LegacyMode =
  | 'kotlin'
  | 'csharp'
  | 'scala'
  | 'dart'
  | 'objectiveC'
  | 'ruby'
  | 'swift'
  | 'lua'
  | 'perl'
  | 'r'
  | 'haskell'
  | 'powershell'
  | 'dockerfile'
  | 'nginx'
  | 'properties'
  | 'protobuf'
  | 'cmake'
  | 'erlang'
  | 'julia'
  | 'groovy'
  | 'clojure'
  | 'fsharp'
  | 'ocaml'
  | 'scss'
  | 'less'
  | 'latex'
  | 'elm'
  | 'vb';

export const PLAIN_LANGUAGE_ID = 'plaintext';

export const SNIPPET_LANGUAGES: SnippetLanguage[] = [
  { id: 'plaintext', name: 'Plain text', ext: 'txt', aliases: ['text', 'txt', 'plain'] },
  { id: 'javascript', name: 'JavaScript', ext: 'js', editor: 'javascript', aliases: ['js', 'node', 'mjs', 'cjs'] },
  { id: 'typescript', name: 'TypeScript', ext: 'ts', editor: 'typescript', aliases: ['ts'] },
  { id: 'jsx', name: 'JSX', ext: 'jsx', editor: 'jsx', aliases: ['react'] },
  { id: 'tsx', name: 'TSX', ext: 'tsx', editor: 'tsx' },
  { id: 'python', name: 'Python', ext: 'py', editor: 'python', aliases: ['py', 'python3'] },
  { id: 'java', name: 'Java', ext: 'java', editor: 'java' },
  { id: 'kotlin', name: 'Kotlin', ext: 'kt', legacy: 'kotlin', aliases: ['kt', 'kts'] },
  { id: 'c', name: 'C', ext: 'c', editor: 'cpp', aliases: ['h'] },
  { id: 'cpp', name: 'C++', ext: 'cpp', editor: 'cpp', aliases: ['c++', 'cc', 'cxx', 'hpp'] },
  { id: 'csharp', name: 'C#', ext: 'cs', legacy: 'csharp', aliases: ['c#', 'cs', 'dotnet'] },
  { id: 'go', name: 'Go', ext: 'go', editor: 'go', aliases: ['golang'] },
  { id: 'rust', name: 'Rust', ext: 'rs', editor: 'rust', aliases: ['rs'] },
  { id: 'php', name: 'PHP', ext: 'php', editor: 'php' },
  { id: 'ruby', name: 'Ruby', ext: 'rb', legacy: 'ruby', aliases: ['rb'] },
  { id: 'swift', name: 'Swift', ext: 'swift', legacy: 'swift' },
  { id: 'objectivec', name: 'Objective-C', ext: 'm', legacy: 'objectiveC', aliases: ['objc', 'objective-c'] },
  { id: 'dart', name: 'Dart', ext: 'dart', legacy: 'dart', aliases: ['flutter'] },
  { id: 'scala', name: 'Scala', ext: 'scala', legacy: 'scala' },
  { id: 'groovy', name: 'Groovy', ext: 'groovy', legacy: 'groovy', aliases: ['gradle'] },
  { id: 'sql', name: 'SQL', ext: 'sql', editor: 'sql', aliases: ['postgres', 'postgresql', 'mysql', 'sqlite'] },
  { id: 'html', name: 'HTML', ext: 'html', editor: 'html', aliases: ['htm'] },
  { id: 'css', name: 'CSS', ext: 'css', editor: 'css' },
  { id: 'scss', name: 'SCSS', ext: 'scss', legacy: 'scss', aliases: ['sass'] },
  { id: 'less', name: 'Less', ext: 'less', legacy: 'less' },
  { id: 'json', name: 'JSON', ext: 'json', editor: 'json', aliases: ['jsonc'] },
  { id: 'yaml', name: 'YAML', ext: 'yaml', editor: 'yaml', aliases: ['yml'] },
  { id: 'toml', name: 'TOML', ext: 'toml', editor: 'toml' },
  { id: 'xml', name: 'XML', ext: 'xml', editor: 'xml', aliases: ['svg', 'xsd', 'plist'] },
  { id: 'markdown', name: 'Markdown', ext: 'md', editor: 'markdown', aliases: ['md'] },
  { id: 'shell', name: 'Shell / Bash', ext: 'sh', editor: 'shell', aliases: ['bash', 'sh', 'zsh', 'shellscript'] },
  { id: 'powershell', name: 'PowerShell', ext: 'ps1', legacy: 'powershell', aliases: ['ps1', 'pwsh', 'ps'] },
  { id: 'dockerfile', name: 'Dockerfile', ext: 'dockerfile', fileName: 'Dockerfile', legacy: 'dockerfile', aliases: ['docker'] },
  { id: 'makefile', name: 'Makefile', ext: 'mk', fileName: 'Makefile', aliases: ['make'] },
  { id: 'cmake', name: 'CMake', ext: 'cmake', legacy: 'cmake' },
  { id: 'nginx', name: 'Nginx config', ext: 'conf', legacy: 'nginx' },
  { id: 'ini', name: 'INI / properties', ext: 'ini', legacy: 'properties', aliases: ['properties', 'cfg', 'env', 'dotenv'] },
  { id: 'protobuf', name: 'Protocol Buffers', ext: 'proto', legacy: 'protobuf', aliases: ['proto'] },
  { id: 'graphql', name: 'GraphQL', ext: 'graphql', aliases: ['gql'] },
  { id: 'lua', name: 'Lua', ext: 'lua', legacy: 'lua' },
  { id: 'perl', name: 'Perl', ext: 'pl', legacy: 'perl', aliases: ['pl'] },
  { id: 'r', name: 'R', ext: 'R', legacy: 'r', aliases: ['rlang'] },
  { id: 'julia', name: 'Julia', ext: 'jl', legacy: 'julia' },
  { id: 'haskell', name: 'Haskell', ext: 'hs', legacy: 'haskell', aliases: ['hs'] },
  { id: 'elixir', name: 'Elixir', ext: 'ex', aliases: ['ex', 'exs'] },
  { id: 'erlang', name: 'Erlang', ext: 'erl', legacy: 'erlang' },
  { id: 'clojure', name: 'Clojure', ext: 'clj', legacy: 'clojure', aliases: ['clj'] },
  { id: 'fsharp', name: 'F#', ext: 'fs', legacy: 'fsharp', aliases: ['f#'] },
  { id: 'ocaml', name: 'OCaml', ext: 'ml', legacy: 'ocaml' },
  { id: 'elm', name: 'Elm', ext: 'elm', legacy: 'elm' },
  { id: 'vb', name: 'Visual Basic', ext: 'vb', legacy: 'vb', aliases: ['vb.net', 'vbnet'] },
  { id: 'latex', name: 'LaTeX', ext: 'tex', legacy: 'latex', aliases: ['tex'] },
  { id: 'diff', name: 'Diff / patch', ext: 'diff', editor: 'diff', aliases: ['patch'] },
];

const byId = new Map(SNIPPET_LANGUAGES.map((l) => [l.id, l]));
const byAlias = new Map<string, SnippetLanguage>();
for (const lang of SNIPPET_LANGUAGES) {
  byAlias.set(lang.id, lang);
  byAlias.set(lang.name.toLowerCase(), lang);
  for (const alias of lang.aliases ?? []) if (!byAlias.has(alias)) byAlias.set(alias, lang);
}

export function getSnippetLanguage(id: string): SnippetLanguage {
  return byId.get(id) ?? byId.get(PLAIN_LANGUAGE_ID)!;
}

/** Resolve a user or file supplied language name ("py", "C#", "TypeScript") to a known id, or null. */
export function resolveLanguageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return byAlias.get(key)?.id ?? null;
}

/** Guess a language from a file name (used when importing a plain file). */
export function languageFromFileName(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return PLAIN_LANGUAGE_ID;
  const ext = lower.slice(dot + 1);
  const hit = SNIPPET_LANGUAGES.find((l) => l.ext.toLowerCase() === ext) ?? byAlias.get(ext);
  return hit?.id ?? PLAIN_LANGUAGE_ID;
}

/** Safe file name for downloading a snippet. */
export function snippetFileName(title: string, languageId: string): string {
  const lang = getSnippetLanguage(languageId);
  if (lang.fileName) return lang.fileName;
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80)
      .toLowerCase() || 'snippet';
  return `${base}.${lang.ext}`;
}
