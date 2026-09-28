import type { Extension } from '@codemirror/state';

export type EditorLanguage =
  | 'plain'
  | 'json'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'html'
  | 'css'
  | 'markdown'
  | 'sql'
  | 'xml'
  | 'yaml'
  | 'python'
  | 'mermaid'
  | 'shell'
  | 'go'
  | 'rust'
  | 'java'
  | 'cpp'
  | 'php'
  | 'toml'
  | 'diff';

const cache = new Map<EditorLanguage, Promise<Extension>>();

/** Loads CodeMirror language support lazily; unknown languages fall back to plain text. */
export function loadLanguage(language: EditorLanguage): Promise<Extension> {
  let pending = cache.get(language);
  if (!pending) {
    pending = load(language).catch(() => []);
    cache.set(language, pending);
  }
  return pending;
}

async function legacy(name: 'shell' | 'toml' | 'diff'): Promise<Extension> {
  const { StreamLanguage } = await import('@codemirror/language');
  if (name === 'shell') return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell);
  if (name === 'toml') return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml);
  return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/diff')).diff);
}

async function load(language: EditorLanguage): Promise<Extension> {
  switch (language) {
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript();
    case 'jsx':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true });
    case 'tsx':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true });
    case 'html':
      return (await import('@codemirror/lang-html')).html();
    case 'css':
      return (await import('@codemirror/lang-css')).css();
    case 'markdown': {
      const [{ markdown, markdownLanguage }, { languages }] = await Promise.all([
        import('@codemirror/lang-markdown'),
        import('@codemirror/language-data'),
      ]);
      return markdown({ base: markdownLanguage, codeLanguages: languages });
    }
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql();
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml();
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml();
    case 'python':
      return (await import('@codemirror/lang-python')).python();
    case 'go':
      return (await import('@codemirror/lang-go')).go();
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust();
    case 'java':
      return (await import('@codemirror/lang-java')).java();
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp();
    case 'php':
      return (await import('@codemirror/lang-php')).php();
    case 'shell':
    case 'toml':
    case 'diff':
      return legacy(language);
    case 'mermaid':
    case 'plain':
    default:
      return [];
  }
}
