import type { Mermaid } from 'mermaid';

export type MermaidTheme = 'default' | 'dark' | 'neutral' | 'forest';

/** Canvas color behind each Mermaid theme (on screen and in PNG exports). */
export const THEME_BACKGROUND: Record<MermaidTheme, string> = {
  default: '#ffffff',
  neutral: '#ffffff',
  forest: '#ffffff',
  dark: '#181b22',
};

let loading: Promise<Mermaid> | null = null;

/** Loads Mermaid on demand (it is a large, separately chunked dependency). */
export function loadMermaid(): Promise<Mermaid> {
  if (!loading) {
    loading = import('mermaid')
      .then((m) => m.default)
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

/**
 * Parses and renders a diagram to an SVG string. Calls are serialized because
 * Mermaid keeps global configuration. Throws Mermaid's parse error (with
 * `hash.loc` for Jison grammars) when the source is invalid.
 *
 * Labels are rendered as SVG text (`htmlLabels: false`) so the SVG has no
 * `<foreignObject>` and can be rasterized to PNG without tainting the canvas.
 */
export function renderMermaid(code: string, theme: MermaidTheme): Promise<string> {
  const run = async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      htmlLabels: false,
      suppressErrorRendering: true,
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
    });
    await mermaid.parse(code);
    const id = `lk-mermaid-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
