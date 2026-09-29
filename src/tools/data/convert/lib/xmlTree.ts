import { XMLValidator } from 'fast-xml-parser';
import { positionAt } from '@/tools/json/lib/json';
import type { ConvertError } from './common';

export interface XmlAttr {
  name: string;
  /** The value including its original quotes, e.g. `"1"` or `'a'`. */
  raw: string;
}

export interface XmlElement {
  type: 'element';
  name: string;
  attrs: XmlAttr[];
  selfClosing: boolean;
  /** Source range of the whole element (open tag through close tag). */
  start: number;
  end: number;
  /** End offset of the opening tag. */
  openEnd: number;
  children: XmlNode[];
}

export interface XmlLeaf {
  type: 'text' | 'comment' | 'cdata' | 'pi' | 'doctype';
  start: number;
  end: number;
}

export type XmlNode = XmlElement | XmlLeaf;

export interface XmlDocument {
  text: string;
  /** Top-level nodes: declaration/PIs, comments, doctype, the root element and whitespace. */
  nodes: XmlNode[];
  root: XmlElement;
}

export class XmlSyntaxError extends Error {
  line: number;
  column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

const NAME_START =
  /[A-Za-z_:À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�\uD800-\uDBFF]/;
const NAME_CHAR = /[\w.:\-·‿-⁀\uDC00-\uDFFF]/;

function isNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  // Combining diacritical marks (U+0300–U+036F) are name characters; checked by code to keep the regex simple.
  if (code >= 0x300 && code <= 0x36f) return true;
  return NAME_CHAR.test(ch) || NAME_START.test(ch);
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function describeChar(ch: string | undefined): string {
  if (ch === undefined) return 'the end of the input';
  if (ch === ' ' || ch === '\t') return 'a space';
  if (ch === '\n' || ch === '\r') return 'a line break';
  return `"${ch}"`;
}

/**
 * Parse XML into a light tree that keeps exact source ranges, so a formatter can
 * re-indent structure without touching text content. Structural problems are
 * reported as XmlSyntaxError with a 1-based line and column. Entities are never
 * expanded and nothing external is ever loaded.
 */
export function buildXmlTree(text: string): XmlDocument {
  const err = (message: string, offset: number): never => {
    const { line, column } = positionAt(text, offset);
    throw new XmlSyntaxError(message, line, column);
  };
  const top: XmlNode[] = [];
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let doctype = false;
  let i = 0;
  const n = text.length;

  const push = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else top.push(node);
  };

  while (i < n) {
    if (text.charCodeAt(i) !== 60 /* < */) {
      const next = text.indexOf('<', i);
      const end = next === -1 ? n : next;
      if (stack.length === 0) {
        let k = i;
        while (k < end && isSpace(text.charCodeAt(k))) k++;
        if (k < end) err(root ? 'Text is not allowed after the root element' : 'Text is not allowed before the root element', k);
      }
      push({ type: 'text', start: i, end });
      i = end;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      if (close === -1) err('Comment is not closed (missing -->)', i);
      push({ type: 'comment', start: i, end: close + 3 });
      i = close + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const close = text.indexOf(']]>', i + 9);
      if (close === -1) err('CDATA section is not closed (missing ]]>)', i);
      if (stack.length === 0) err('CDATA is not allowed outside the root element', i);
      push({ type: 'cdata', start: i, end: close + 3 });
      i = close + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      const close = text.indexOf('?>', i + 2);
      if (close === -1) err('Processing instruction is not closed (missing ?>)', i);
      push({ type: 'pi', start: i, end: close + 2 });
      i = close + 2;
      continue;
    }
    if (text.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [ ... ] that may contain comments and PIs.
      if (stack.length > 0 || root) err('A <!DOCTYPE> declaration is only allowed before the root element', i);
      if (doctype) err('A document can only have one <!DOCTYPE> declaration', i);
      let j = i + 2;
      let depth = 0;
      let quote = '';
      for (; j < n; j++) {
        const ch = text[j];
        if (quote) {
          if (ch === quote) quote = '';
        } else if (text.startsWith('<!--', j)) {
          const close = text.indexOf('-->', j + 4);
          if (close === -1) err('Comment is not closed (missing -->)', j);
          j = close + 2;
        } else if (text.startsWith('<?', j)) {
          const close = text.indexOf('?>', j + 2);
          if (close === -1) err('Processing instruction is not closed (missing ?>)', j);
          j = close + 1;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      if (j >= n) err('Declaration is not closed (missing >)', i);
      doctype = true;
      push({ type: 'doctype', start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (text.startsWith('</', i)) {
      let j = i + 2;
      while (j < n && isNameChar(text[j])) j++;
      const name = text.slice(i + 2, j);
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      if (!name) err(`A closing tag needs a name, but found ${describeChar(text[i + 2])} after </`, i);
      if (text[j] !== '>') err(`Closing tag </${name}> is malformed (expected >, found ${describeChar(text[j])})`, j);
      const open = stack.pop();
      if (!open) return err(`Closing tag </${name}> has no matching opening tag`, i);
      if (open.name !== name) {
        const opened = positionAt(text, open.start);
        err(`Expected closing tag </${open.name}> (opened on line ${opened.line}) but found </${name}>`, i);
      }
      open.end = j + 1;
      i = j + 1;
      continue;
    }
    // Opening tag.
    let j = i + 1;
    if (j >= n || !NAME_START.test(text[j])) {
      err(`${describeChar(text[j])} cannot start a tag name (use &lt; for a literal <)`, j < n ? j : i);
    }
    while (j < n && isNameChar(text[j])) j++;
    const name = text.slice(i + 1, j);
    const attrs: XmlAttr[] = [];
    let selfClosing = false;
    for (;;) {
      const beforeSpace = j;
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      if (j >= n) err(`Tag <${name}> is not closed (missing >)`, i);
      if (text[j] === '>') {
        j++;
        break;
      }
      if (text[j] === '/' && text[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      if (j === beforeSpace && attrs.length > 0) err(`Attributes in <${name}> must be separated by whitespace`, j);
      const attrStart = j;
      while (j < n && isNameChar(text[j])) j++;
      if (j === attrStart) err(`Unexpected ${describeChar(text[j])} in tag <${name}>`, j);
      const attrName = text.slice(attrStart, j);
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      if (text[j] !== '=') err(`Attribute "${attrName}" has no value`, attrStart);
      j++;
      while (j < n && isSpace(text.charCodeAt(j))) j++;
      const q = text[j];
      if (q !== '"' && q !== "'") err(`Value of attribute "${attrName}" must be quoted`, j);
      const close = text.indexOf(q, j + 1);
      if (close === -1) err(`Value of attribute "${attrName}" is not closed`, j);
      const lt = text.indexOf('<', j + 1);
      if (lt !== -1 && lt < close) err(`Value of attribute "${attrName}" contains "<" (write it as &lt;)`, lt);
      if (attrs.some((a) => a.name === attrName)) err(`Attribute "${attrName}" appears more than once in <${name}>`, attrStart);
      attrs.push({ name: attrName, raw: text.slice(j, close + 1) });
      j = close + 1;
    }
    const element: XmlElement = { type: 'element', name, attrs, selfClosing, start: i, end: j, openEnd: j, children: [] };
    if (stack.length === 0) {
      if (root) err(`XML documents must have a single root element, but <${name}> follows <${root.name}>`, i);
      root = element;
    }
    push(element);
    if (!selfClosing) stack.push(element);
    i = j;
  }
  if (stack.length) {
    const open = stack[stack.length - 1];
    err(`Element <${open.name}> is not closed`, open.start);
  }
  if (!root) return err('No root element found', 0);
  return { text, nodes: top, root };
}

/**
 * Check well-formedness and build the tree. The tree builder reports structural
 * problems (with precise positions) first; fast-xml-parser's validator then checks
 * names, entity syntax and declarations. Errors carry 1-based line and column.
 */
export function parseXmlDocument(text: string): { ok: true; doc: XmlDocument } | { ok: false; error: ConvertError } {
  if (!text.trim()) return { ok: false, error: { message: 'Input is empty' } };
  let doc: XmlDocument;
  try {
    doc = buildXmlTree(text);
  } catch (error) {
    if (error instanceof XmlSyntaxError) {
      return { ok: false, error: { message: error.message, line: error.line, column: error.column } };
    }
    if (error instanceof RangeError) return { ok: false, error: { message: 'The XML is nested too deeply.' } };
    throw error;
  }
  // The tree builder already checked the DOCTYPE; blank it out (keeping offsets) because the
  // validator trips over comments and processing instructions inside internal subsets.
  let checkText = text;
  for (const node of doc.nodes) {
    if (node.type === 'doctype') {
      checkText = text.slice(0, node.start) + text.slice(node.start, node.end).replace(/[^\n]/g, ' ') + text.slice(node.end);
    }
  }
  const result = XMLValidator.validate(checkText, { allowBooleanAttributes: false });
  if (result !== true) {
    const { msg, line, col } = result.err;
    return { ok: false, error: { message: msg.replace(/\.$/, ''), line: line || 1, column: col || 1 } };
  }
  return { ok: true, doc };
}
