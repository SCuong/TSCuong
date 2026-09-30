export interface DiagramRecord {
  id: string;
  name: string;
  code: string;
  /** Template the diagram started from; "Reset to example" restores it. */
  templateId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DiagramError {
  /** One human sentence describing the problem. */
  message: string;
  /** 1-based source line, when Mermaid reports one. */
  line: number | null;
  /** 1-based column on that line, when known. */
  column: number | null;
  /** The offending source line's text, for context. */
  sourceLine: string | null;
}

interface JisonHash {
  line?: number;
  loc?: { first_line?: number; first_column?: number };
  token?: string | number;
}

/** Tokens Jison grammars report when the text ends in the middle of a statement ("1" is Jison's EOF id). */
const END_TOKENS = new Set(['EOF', '1', '$end', 'EOF_IN_STRUCT']);

/** Plain-language names for common Jison grammar tokens (null when a token has no useful name). */
const TOKEN_LABELS: Record<string, string> = {
  NEWLINE: 'a line break',
  NL: 'a line break',
  EOF: 'the end of the diagram',
  SPACE: 'a space',
  PS: '"("',
  PE: '")"',
  SQS: '"["',
  SQE: '"]"',
  DIAMOND_START: '"{"',
  DIAMOND_STOP: '"}"',
  STR: 'a quoted text',
  PIPE: '"|"',
  COLON: '":"',
  SEMI: '";"',
  COMMA: '","',
  AMP: '"&"',
  MINUS: '"-"',
  ARROW_POINT: 'an arrow',
  LINK: 'a link such as "-->"',
  START_LINK: 'a link such as "-->"',
  NODE_STRING: 'a node name',
  ALPHA: 'a name',
  NUM: 'a number',
  TXT: 'text',
  end: '"end"',
};

function tokenLabel(token: string): string | null {
  if (TOKEN_LABELS[token]) return TOKEN_LABELS[token];
  // Literal punctuation/keywords come through as themselves, e.g. '-->' or 'participant'.
  if (!/^[A-Z_0-9]+$/.test(token)) return `"${token}"`;
  return null;
}

/**
 * Turns an error thrown by `mermaid.parse`/`render` into a short message plus
 * the source line it points at. Handles both the Jison parsers (flowchart,
 * sequence, …: `err.hash.loc.first_line`) and the Langium ones (pie,
 * gitGraph, …: "Parse error on line 2, column 6: …").
 */
export function describeMermaidError(error: unknown, source: string): DiagramError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const hash = (error as { hash?: JisonHash } | null)?.hash;
  const sourceLines = source.replace(/\r\n?/g, '\n').split('\n');
  let line: number | null = null;
  let column: number | null = null;
  if (hash?.loc?.first_line) {
    line = hash.loc.first_line;
    if (typeof hash.loc.first_column === 'number') column = hash.loc.first_column + 1;
  } else {
    const m = /line (\d+)(?:, column (\d+))?/i.exec(raw);
    if (m) {
      line = Number(m[1]);
      if (m[2]) column = Number(m[2]);
    }
  }

  const lines = raw
    .replace(/^Parsing failed:\s*/i, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // Jison messages: "Parse error on line N:", "<snippet>", "----^", "Expecting …, got …"
  let message = lines.find((l) => /^Expecting /.test(l)) ?? lines[lines.length - 1] ?? '';
  if (/^Expecting /.test(message)) {
    const got = /got '([^']+)'/.exec(message)?.[1] ?? (hash?.token !== undefined ? String(hash.token) : undefined);
    // Only list expectations we can name in plain words; grammar-internal token names mean nothing to users.
    const expected = [
      ...new Set(
        [...message.matchAll(/'([^']+)'/g)]
          .map((m) => m[1])
          .filter((t) => t !== got)
          .map(tokenLabel)
          .filter((t): t is string => t !== null),
      ),
    ];
    const shown = expected.slice(0, 5).join(', ') + (expected.length > 5 ? ', …' : '');
    const hint = expected.length ? ` Expected ${expected.length === 1 ? '' : 'one of: '}${shown}${shown.endsWith('…') ? '' : '.'}` : '';
    const gotLabel = got ? (tokenLabel(got) ?? `"${got.toLowerCase()}"`).replace(/^(a|an|the) /, '') : 'text';
    message = got !== undefined && END_TOKENS.has(got) ? `The diagram ends unexpectedly.${hint}` : `Unexpected ${gotLabel}.${hint}`;
  } else {
    message = message.replace(/^Parse error on line \d+(, column \d+)?:\s*/i, '');
    const date = /^Invalid date:\s*(.*)$/i.exec(message);
    if (date) message = `Invalid date "${date[1]}". Use the dateFormat of the chart (for example 2026-03-02).`;
  }
  if (!message) message = 'Mermaid could not parse this diagram.';
  if (/No diagram type detected/i.test(raw)) {
    message = 'No diagram type found. Start with a keyword such as "flowchart TD", "sequenceDiagram" or "pie".';
    line = 1;
    column = null;
  }
  // No position reported (e.g. a bad date or branch name): point at the line containing the offending text.
  if (line === null) {
    const needle =
      (typeof hash?.token === 'string' && hash.token.trim().length > 1 ? hash.token.trim() : null) ??
      /^Invalid date:\s*(\S+)/i.exec(raw)?.[1] ??
      null;
    const found = needle ? sourceLines.findIndex((l) => l.includes(needle)) : -1;
    if (found >= 0) {
      line = found + 1;
      column = sourceLines[found].indexOf(needle!) + 1;
    }
  }
  if (line !== null) line = Math.min(Math.max(1, line), sourceLines.length);
  message = message.charAt(0).toUpperCase() + message.slice(1);
  if (!/[.…!?"]$/.test(message)) message += '.';
  const sourceLine = line !== null ? (sourceLines[line - 1] ?? null) : null;
  if (column !== null) column = sourceLine === null ? null : Math.min(Math.max(1, column), sourceLine.length + 1);
  return { message, line, column, sourceLine };
}

/** Natural size of a Mermaid SVG from its viewBox (falls back to width/height attributes). */
export function svgSize(svg: string): { width: number; height: number } | null {
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(svg)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const w = Number(/<svg[^>]*\swidth\s*=\s*"([\d.]+)(px)?"/i.exec(svg)?.[1]);
  const h = Number(/<svg[^>]*\sheight\s*=\s*"([\d.]+)(px)?"/i.exec(svg)?.[1]);
  if (w > 0 && h > 0) return { width: w, height: h };
  return null;
}

/**
 * Makes a Mermaid SVG self-contained for download: explicit pixel size (Mermaid
 * emits `width="100%"` + max-width style), XML namespace and declaration.
 */
export function standaloneSvg(svg: string, background?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${sizedSvg(svg, background)}\n`;
}

/**
 * The SVG with an explicit pixel width/height from its viewBox (replacing
 * Mermaid's `width="100%"` and max-width style) so it can be zoomed and exported
 * at its natural size. Optionally paints a background color.
 */
export function sizedSvg(svg: string, background?: string): string {
  const size = svgSize(svg);
  return svg.trim().replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let a = attrs
      .replace(/\swidth\s*=\s*"[^"]*"/i, '')
      .replace(/\sheight\s*=\s*"[^"]*"/i, '')
      .replace(/\sstyle\s*=\s*"[^"]*"/i, '');
    if (!/\sxmlns\s*=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    if (size) a += ` width="${Math.ceil(size.width)}" height="${Math.ceil(size.height)}"`;
    if (background) a += ` style="background-color: ${background}"`;
    return `<svg${a}>`;
  });
}

/** A safe file name (without extension) for a diagram. */
export function diagramFileName(name: string): string {
  let clean = '';
  // Control characters are not allowed in file names.
  for (const ch of name.normalize('NFKC')) clean += ch.charCodeAt(0) < 0x20 ? ' ' : ch;
  const base = clean
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return base || 'diagram';
}

/** A name not already in `existing`: "Untitled diagram", "Untitled diagram 2", … */
export function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zoom by `factor` keeping the point (px, py) (in viewport coordinates) fixed. */
export function zoomAt(view: ViewTransform, factor: number, px: number, py: number): ViewTransform {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Transform that fits content of the given size centered inside the viewport, with padding. Never upscales past 100%. */
export function fitTransform(
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  padding = 24,
): ViewTransform {
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const scale = clampScale(Math.min(1, availW / content.width, availH / content.height));
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}
