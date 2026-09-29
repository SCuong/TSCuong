import { normalizeInput, ok, type ConvertResult, type IndentOption, indentText } from './common';
import { parseXmlDocument, type XmlDocument, type XmlElement, type XmlNode } from './xmlTree';

/** How elements without content are written: as found, always `<a/>`, or always `<a></a>`. */
export type EmptyElementStyle = 'keep' | 'collapse' | 'expand';
/** Attributes on the tag line, one per line (when there are 2+), or one per line only for long tags. */
export type AttributeLayout = 'inline' | 'multiline' | 'auto';

export interface XmlFormatOptions {
  indent: IndentOption;
  /** Default 'keep'. */
  emptyElements?: EmptyElementStyle;
  /** Default 'inline'. */
  attributes?: AttributeLayout;
  /** Maximum tag width before 'auto' puts attributes on separate lines. Default 100. */
  lineWidth?: number;
  /** Rewrite single-quoted attribute values with double quotes. */
  doubleQuotes?: boolean;
  removeComments?: boolean;
}

export interface XmlMinifyOptions {
  removeComments?: boolean;
}

export interface XmlStats {
  elements: number;
  attributes: number;
  maxDepth: number;
  comments: number;
  cdata: number;
  /** Processing instructions other than the XML declaration. */
  processingInstructions: number;
  /** xmlns and xmlns:prefix declarations. */
  namespaces: number;
  /** Text nodes that are not just whitespace. */
  textNodes: number;
  doctype: boolean;
  declaration: boolean;
  root: string;
}

interface Ctx {
  doc: XmlDocument;
  text: string;
  unit: string;
  options: XmlFormatOptions;
}

/** Attribute value with double quotes (escaping any double quote it contains). */
function doubleQuoted(raw: string): string {
  if (raw.startsWith('"')) return raw;
  return `"${raw.slice(1, -1).replace(/"/g, '&quot;')}"`;
}

function attributeList(el: XmlElement, doubleQuotes: boolean | undefined): string[] {
  return el.attrs.map((a) => `${a.name}=${doubleQuotes ? doubleQuoted(a.raw) : a.raw}`);
}

function openTag(el: XmlElement, selfClose: boolean, ctx: Ctx | null, pad = ''): string {
  const attrs = attributeList(el, ctx?.options.doubleQuotes);
  const close = selfClose ? '/>' : '>';
  const inline = `<${el.name}${attrs.map((a) => ` ${a}`).join('')}${close}`;
  if (!ctx || attrs.length < 2) return inline;
  const layout = ctx.options.attributes ?? 'inline';
  const width = ctx.options.lineWidth ?? 100;
  const visualPad = pad.replace(/\t/g, '    ').length;
  if (layout === 'inline' || (layout === 'auto' && visualPad + inline.length <= width)) return inline;
  const inner = pad + ctx.unit;
  return `<${el.name}\n${attrs.map((a) => inner + a).join('\n')}${close}`;
}

function isWhitespaceText(text: string, node: XmlNode): boolean {
  return node.type === 'text' && text.slice(node.start, node.end).trim() === '';
}

function preservesSpace(el: XmlElement): boolean {
  return el.attrs.some((a) => a.name === 'xml:space' && a.raw.slice(1, -1).trim() === 'preserve');
}

type Content = 'empty' | 'text' | 'block' | 'mixed';

function childrenOf(el: XmlElement, removeComments: boolean | undefined): XmlNode[] {
  return removeComments ? el.children.filter((c) => c.type !== 'comment') : el.children;
}

function classify(text: string, children: XmlNode[]): Content {
  if (children.length === 0) return 'empty';
  let hasChars = false;
  let hasStructure = false;
  for (const child of children) {
    if (child.type === 'text') {
      if (!isWhitespaceText(text, child)) hasChars = true;
    } else if (child.type === 'cdata') hasChars = true;
    else hasStructure = true;
  }
  // Whitespace-only content with no child elements is kept verbatim, like any other text.
  if (!hasStructure) return 'text';
  return hasChars ? 'mixed' : 'block';
}

/** Source of a node exactly as written, optionally without comments (used for mixed content). */
function rawSource(text: string, node: XmlNode, removeComments: boolean | undefined): string {
  if (!removeComments) return text.slice(node.start, node.end);
  if (node.type === 'comment') return '';
  if (node.type !== 'element') return text.slice(node.start, node.end);
  if (node.selfClosing) return text.slice(node.start, node.end);
  return text.slice(node.start, node.openEnd) + node.children.map((c) => rawSource(text, c, true)).join('') + `</${node.name}>`;
}

/** Pretty-print well-formed XML. Text content is never altered; mixed content is kept as written. */
export function formatXml(input: string, options: XmlFormatOptions): ConvertResult {
  const text = normalizeInput(input);
  const parsed = parseXmlDocument(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const ctx: Ctx = { doc: parsed.doc, text, unit: indentText(options.indent), options };
  const lines: string[] = [];
  const src = (start: number, end: number) => text.slice(start, end);
  const emptyStyle = options.emptyElements ?? 'keep';

  const emit = (node: XmlNode, depth: number) => {
    const pad = ctx.unit.repeat(depth);
    if (node.type === 'text') {
      const t = src(node.start, node.end).trim();
      if (t) lines.push(pad + t);
      return;
    }
    if (node.type === 'comment' && options.removeComments) return;
    if (node.type !== 'element') {
      lines.push(pad + src(node.start, node.end));
      return;
    }
    const children = childrenOf(node, options.removeComments);
    const kind = classify(text, children);
    if (kind === 'empty') {
      const collapse = emptyStyle === 'collapse' || (emptyStyle === 'keep' && node.selfClosing);
      lines.push(pad + openTag(node, collapse, ctx, pad) + (collapse ? '' : `</${node.name}>`));
      return;
    }
    if (preservesSpace(node) || kind === 'mixed') {
      const inner = children.map((c) => rawSource(text, c, options.removeComments)).join('');
      lines.push(`${pad}${openTag(node, false, ctx, pad)}${inner}</${node.name}>`);
      return;
    }
    if (kind === 'text') {
      const inner = children.map((c) => src(c.start, c.end)).join('');
      lines.push(`${pad}${openTag(node, false, ctx, pad)}${inner}</${node.name}>`);
      return;
    }
    lines.push(pad + openTag(node, false, ctx, pad));
    for (const child of children) emit(child, depth + 1);
    lines.push(`${pad}</${node.name}>`);
  };

  try {
    for (const node of parsed.doc.nodes) emit(node, 0);
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: { message: 'The XML is nested too deeply to format.' } };
    throw error;
  }
  return ok(lines.join('\n') + '\n');
}

/** Remove insignificant whitespace between tags (and optionally comments). Text content is kept. */
export function minifyXml(input: string, options: XmlMinifyOptions = {}): ConvertResult {
  const text = normalizeInput(input);
  const parsed = parseXmlDocument(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const out: string[] = [];

  const emit = (node: XmlNode, keepText: boolean) => {
    if (node.type === 'text') {
      const t = text.slice(node.start, node.end);
      if (keepText || t.trim()) out.push(keepText ? t : t.trim());
      return;
    }
    if (node.type === 'comment' && options.removeComments) return;
    if (node.type !== 'element') {
      out.push(text.slice(node.start, node.end));
      return;
    }
    const children = childrenOf(node, options.removeComments);
    const kind = classify(text, children);
    if (node.selfClosing || kind === 'empty') {
      out.push(openTag(node, true, null));
      return;
    }
    out.push(openTag(node, false, null));
    const keep = preservesSpace(node) || kind === 'mixed' || kind === 'text';
    for (const child of children) emit(child, keep);
    out.push(`</${node.name}>`);
  };

  try {
    for (const node of parsed.doc.nodes) {
      if (node.type === 'text') continue;
      emit(node, false);
    }
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: { message: 'The XML is nested too deeply to minify.' } };
    throw error;
  }
  return ok(out.join(''));
}

/** Counts for a well-formed document, or null when the XML is not well-formed. */
export function xmlStats(input: string): XmlStats | null {
  const text = normalizeInput(input);
  const parsed = parseXmlDocument(text);
  if (!parsed.ok) return null;
  const stats: XmlStats = {
    elements: 0,
    attributes: 0,
    maxDepth: 0,
    comments: 0,
    cdata: 0,
    processingInstructions: 0,
    namespaces: 0,
    textNodes: 0,
    doctype: false,
    declaration: false,
    root: parsed.doc.root.name,
  };
  const stack: Array<[XmlNode, number]> = parsed.doc.nodes.map((n) => [n, 1]);
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    switch (node.type) {
      case 'comment':
        stats.comments++;
        break;
      case 'cdata':
        stats.cdata++;
        break;
      case 'doctype':
        if (/^<!DOCTYPE/i.test(text.slice(node.start, node.start + 9))) stats.doctype = true;
        break;
      case 'pi':
        if (/^<\?xml[\s?]/.test(text.slice(node.start, node.start + 6))) stats.declaration = true;
        else stats.processingInstructions++;
        break;
      case 'text':
        if (depth > 1 && text.slice(node.start, node.end).trim()) stats.textNodes++;
        break;
      case 'element':
        stats.elements++;
        stats.attributes += node.attrs.length;
        stats.namespaces += node.attrs.filter((a) => a.name === 'xmlns' || a.name.startsWith('xmlns:')).length;
        stats.maxDepth = Math.max(stats.maxDepth, depth);
        for (const child of node.children) stack.push([child, depth + 1]);
        break;
    }
  }
  return stats;
}
