import type { EditorLanguage } from '@/components/editor/languages';

/** Extensions whose content is extracted as text. */
export const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc',
  'json', 'jsonc', 'json5', 'ndjson', 'geojson', 'csv', 'tsv',
  'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'vue', 'svelte', 'astro',
  'py', 'pyi', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'dart', 'lua', 'pl', 'r',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'fs', 'vb', 'rb', 'php', 'ex', 'exs', 'erl', 'clj', 'hs', 'elm', 'zig', 'nim',
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl',
  'xml', 'xsd', 'xsl', 'plist', 'svg', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto', 'prisma', 'tf', 'hcl',
  'log', 'diff', 'patch', 'tex', 'bib', 'srt', 'vtt', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'lock',
  'jsonl', 'gradle', 'groovy', 'cmake', 'mk', 'jl', 'm', 'mm', 'ejs', 'hbs', 'pug', 'twig', 'liquid', 'njk', 'cshtml', 'razor',
  'xaml', 'csproj', 'vbproj', 'fsproj', 'sln', 'props', 'targets', 'ipynb', 'sol', 'nix', 'bzl', 'dockerignore', 'htaccess',
]);

/**
 * Formats that are never plain text (images, media, archives, Office files,
 * fonts, executables, databases). They are indexed by name only without being
 * read; files with any other unknown extension are sniffed for text.
 */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif', 'psd', 'ai', 'raw', 'cr2', 'nef', 'dng',
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wma', 'mp4', 'm4v', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', '3gp',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'tar', 'jar', 'war', 'apk', 'aab', 'ipa', 'dmg', 'iso', 'img', 'cab', 'deb', 'rpm', 'msi',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'obj', 'a', 'lib', 'class', 'pyc', 'pyo', 'wasm', 'node', 'pdb',
  'sqlite', 'sqlite3', 'db', 'db3', 'mdb', 'accdb', 'parquet', 'avro', 'npy', 'npz', 'pkl', 'h5', 'onnx', 'pt',
]);

/** Extension-less file names that are text. */
const TEXT_NAMES = new Set([
  'readme', 'license', 'licence', 'changelog', 'authors', 'contributors', 'notice', 'copying', 'todo',
  'makefile', 'dockerfile', 'containerfile', 'procfile', 'gemfile', 'rakefile', 'vagrantfile', 'jenkinsfile', 'brewfile',
  'codeowners', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc', '.babelrc', '.env',
]);

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);

/** Lower-case extension without the dot ("" when there is none). Dotfiles like ".env" have extension "env". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_NAMES.has(lower)) return true;
  // .env.local, .env.production …
  if (/^\.env(\.|$)/.test(lower)) return true;
  const ext = extensionOf(lower);
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  return !ext && TEXT_NAMES.has(lower.replace(/\..*$/, ''));
}

/** A format that is certainly not text (see {@link BINARY_EXTENSIONS}). */
export function isKnownBinaryFile(name: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(name.toLowerCase()));
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

const LANGUAGES: Record<string, EditorLanguage> = {
  json: 'json', jsonc: 'json', json5: 'json', geojson: 'json',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html', astro: 'html',
  css: 'css', scss: 'css', less: 'css', sass: 'css',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  sql: 'sql', xml: 'xml', xsd: 'xml', xsl: 'xml', svg: 'xml', plist: 'xml',
  yml: 'yaml', yaml: 'yaml', py: 'python', pyi: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', env: 'shell',
  go: 'go', rs: 'rust', java: 'java', kt: 'java', c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'java',
  php: 'php', toml: 'toml', ini: 'toml', diff: 'diff', patch: 'diff',
};

export function languageFor(name: string): EditorLanguage {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower === 'makefile') return 'shell';
  if (/^\.env(\.|$)/.test(lower)) return 'shell';
  return LANGUAGES[extensionOf(lower)] ?? 'plain';
}
