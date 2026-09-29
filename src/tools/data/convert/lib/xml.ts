import { XMLBuilder, XMLParser, type X2jOptions } from 'fast-xml-parser';
import {
  fail,
  indentText,
  LOSSY_INTEGER_WARNING,
  normalizeInput,
  ok,
  plural,
  readJsonLossless,
  setOwn,
  stringifyJsonLossless,
  type ConvertResult,
  type IndentOption,
} from './common';
import { parseXmlDocument, type XmlDocument, type XmlNode } from './xmlTree';

export interface XmlToJsonOptions {
  indent: IndentOption;
  /** Include attributes (as prefixed keys). */
  attributes: boolean;
  attributePrefix: string;
  textKey: string;
  /** Convert numeric and true/false text to numbers and booleans. */
  parseValues: boolean;
  /** Always produce arrays for child elements, even when they appear once. */
  alwaysArray: boolean;
  stripNamespaces?: boolean;
}

export interface JsonToXmlOptions {
  indent: IndentOption;
  /** Root element name used when the JSON does not have exactly one top-level key. */
  rootName: string;
  /** Element name for items of nested arrays and of a top-level array. */
  itemName: string;
  attributePrefix: string;
  textKey: string;
  declaration: boolean;
}

export const ATTRIBUTE_PREFIXES = ['@_', '@', '_', '$', '-'] as const;
export const TEXT_KEYS = ['#text', '_text', '$t', 'value'] as const;

function scanDocument(doc: XmlDocument) {
  const found = { mixed: false, comments: 0, pis: 0 };
  const stack: XmlNode[] = [...doc.nodes];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'comment') found.comments++;
    else if (node.type === 'pi' && !/^<\?xml[\s?]/.test(doc.text.slice(node.start, node.start + 6))) found.pis++;
    if (node.type !== 'element') continue;
    let chars = false;
    let elements = false;
    for (const child of node.children) {
      stack.push(child);
      if (child.type === 'element') elements = true;
      else if (child.type === 'cdata') chars = true;
      else if (child.type === 'text' && doc.text.slice(child.start, child.end).trim()) chars = true;
    }
    if (chars && elements) found.mixed = true;
  }
  return found;
}

// fast-xml-parser refuses these names (prototype pollution guard). They are harmless as plain
// JSON keys, so they are renamed to a marker while parsing and restored in the JSON text.
// XML text can never contain U+0000, so the marker cannot collide with document content.
const CRITICAL_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const NAME_MARK = '\u0000lk-name:';

function protectName(name: string): string {
  const local = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return CRITICAL_NAMES.has(name) || CRITICAL_NAMES.has(local) ? NAME_MARK + name : name;
}

function restoreNames(json: string): string {
  return json.includes('\\u0000lk-name:') ? json.replace(/\\u0000lk-name:/g, '') : json;
}

/** Put attributes first and the text key next, as they appear in the XML (the parser appends them). */
function attributesFirst(value: unknown, prefix: string, textKey: string): unknown {
  if (Array.isArray(value)) return value.map((v) => attributesFirst(v, prefix, textKey));
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  const rank = (key: string) => (prefix && key.startsWith(prefix) ? 0 : key === textKey ? 1 : 2);
  const out: Record<string, unknown> = {};
  for (const r of [0, 1, 2]) {
    for (const [k, v] of entries) if (rank(k) === r) setOwn(out, k, attributesFirst(v, prefix, textKey));
  }
  return out;
}

export function xmlToJson(input: string, options: XmlToJsonOptions): ConvertResult {
  const text = normalizeInput(input);
  if (!text.trim()) return fail('Input is empty');
  if (options.attributes && !options.attributePrefix) return fail('The attribute prefix cannot be empty.');
  if (!options.textKey) return fail('The text key cannot be empty.');
  const checked = parseXmlDocument(text);
  if (!checked.ok) return { ok: false, error: checked.error };

  const rootName = checked.doc.root.name;
  const rootPath = protectName(options.stripNamespaces ? rootName.replace(/^[^:]*:/, '') : rootName);
  const config: X2jOptions = {
    ignoreAttributes: !options.attributes,
    attributeNamePrefix: options.attributePrefix,
    textNodeName: options.textKey,
    parseTagValue: options.parseValues,
    parseAttributeValue: options.parseValues,
    numberParseOptions: { leadingZeros: false, hex: false, eNotation: true },
    ignoreDeclaration: true,
    ignorePiTags: true,
    htmlEntities: true,
    removeNSPrefix: Boolean(options.stripNamespaces),
    allowBooleanAttributes: false,
    trimValues: true,
    jPath: true,
    maxNestedTags: 5000,
    transformTagName: protectName,
    transformAttributeName: protectName,
    onDangerousProperty: (name: string) => name,
    // Passing `isArray: undefined` would override the library default, so only set it when needed.
    ...(options.alwaysArray
      ? { isArray: (_name: string, jpath: unknown, _leaf: boolean, isAttribute: boolean) => !isAttribute && jpath !== rootPath }
      : {}),
  };

  const warnings: string[] = [];
  let value: unknown;
  try {
    value = new XMLParser(config).parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/external entit/i.test(message)) {
      // Never load external entities: ignore the DOCTYPE's declarations (standard entities still decode).
      let withoutDoctype = text;
      for (const node of checked.doc.nodes) {
        if (node.type === 'doctype') withoutDoctype = text.slice(0, node.start) + text.slice(node.end);
      }
      try {
        value = new XMLParser(config).parse(withoutDoctype);
        warnings.push('The DOCTYPE declares external entities, which are never loaded. Its entity declarations were ignored.');
      } catch (retryError) {
        return fail(describeParserError(retryError));
      }
    } else {
      return fail(describeParserError(error));
    }
  }
  try {
    value = attributesFirst(value, options.attributes ? options.attributePrefix : '', options.textKey);
  } catch (error) {
    if (error instanceof RangeError) return fail('The XML is nested too deeply to convert.');
    throw error;
  }
  const found = scanDocument(checked.doc);
  if (found.mixed) {
    warnings.push('Some elements mix text with child elements. JSON cannot keep that order, so their text parts were joined.');
  }
  if (found.comments) warnings.push(`${plural(found.comments, 'comment')} ${found.comments === 1 ? 'was' : 'were'} dropped, because JSON has no comments.`);
  if (found.pis) warnings.push(`${plural(found.pis, 'processing instruction')} (<?…?>) ${found.pis === 1 ? 'was' : 'were'} dropped.`);
  try {
    return ok(restoreNames(stringifyJsonLossless(value, options.indent, warnings)), warnings);
  } catch (error) {
    if (error instanceof RangeError) return fail('The XML is nested too deeply to convert.');
    throw error;
  }
}

function describeParserError(error: unknown): string {
  if (error instanceof RangeError) return 'The XML is nested too deeply to convert.';
  const message = error instanceof Error ? error.message : '';
  if (/Maximum nested tags/i.test(message)) return 'The XML is nested more than 5,000 levels deep, which is too deep to convert.';
  if (/entit/i.test(message)) return `The document's entities could not be expanded safely: ${message}`;
  return message || 'Could not parse the XML.';
}

const XML_NAME = /^[A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�][\w.\-·À-ÖØ-öø-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]*(?::[A-Za-z_][\w.-]*)?$/;

/** False for characters that may appear inside an XML name but not at its start (·, combining marks, ‿ ⁀, ×, ÷). */
function isXmlNameStartCode(code: number): boolean {
  if (code === 0xb7 || code === 0xd7 || code === 0xf7 || code === 0x203f || code === 0x2040) return false;
  return !(code >= 0x300 && code <= 0x36f);
}

/** Turn an arbitrary JSON key into a valid XML element or attribute name. */
export function toXmlName(key: string): string {
  if (XML_NAME.test(key)) return key;
  let name = key.replace(/[^\w.\-·À-ÖØ-öø-ͽͿ-῿‌-‍‿-⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/g, '_');
  if (!/^[A-Za-z_À-�]/.test(name) || !isXmlNameStartCode(name.charCodeAt(0))) name = `_${name}`;
  return name || '_';
}

// Characters that are not allowed anywhere in an XML 1.0 document.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function jsonToXml(input: string, options: JsonToXmlOptions): ConvertResult {
  if (!input.trim()) return fail('Input is empty');
  const parsed = readJsonLossless(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const rootName = options.rootName.trim();
  if (!rootName || toXmlName(rootName) !== rootName) return fail(`"${options.rootName}" is not a valid XML element name for the root.`);
  const itemName = options.itemName.trim();
  if (!itemName || toXmlName(itemName) !== itemName) return fail(`"${options.itemName}" is not a valid XML element name for array items.`);
  if (!options.attributePrefix) return fail('The attribute prefix cannot be empty.');
  if (!options.textKey) return fail('The text key cannot be empty.');

  const renamed = new Map<string, string>();
  let strippedChars = 0;
  let emptyArrays = 0;
  const cleanString = (s: string) => {
    const cleaned = s.replace(INVALID_XML_CHARS, '');
    strippedChars += s.length - cleaned.length;
    return cleaned;
  };

  const prepare = (value: unknown): unknown => {
    if (typeof value === 'string') return cleanString(value);
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) {
      if (value.length === 0) emptyArrays++;
      // Arrays repeat their parent element; nested arrays get an item element each.
      return value.map((item) => (Array.isArray(item) ? { [itemName]: prepare(item) } : prepare(item)));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        if (key === options.textKey) {
          setOwn(out, key, child !== null && typeof child === 'object' ? JSON.stringify(child, bigintReplacer) : prepare(child));
          continue;
        }
        const isAttr = key.startsWith(options.attributePrefix) && key.length > options.attributePrefix.length;
        const bare = isAttr ? key.slice(options.attributePrefix.length) : key;
        let name = toXmlName(bare);
        if (name !== bare) renamed.set(bare, name);
        let finalKey = isAttr ? options.attributePrefix + name : name;
        let n = 2;
        while (Object.hasOwn(out, finalKey)) {
          name = `${toXmlName(bare)}_${n++}`;
          renamed.set(bare, name);
          finalKey = isAttr ? options.attributePrefix + name : name;
        }
        if (isAttr) {
          setOwn(out, finalKey, child !== null && typeof child === 'object' ? JSON.stringify(child, bigintReplacer) : child === null ? '' : prepare(child));
        } else {
          setOwn(out, finalKey, prepare(child));
        }
      }
      return out;
    }
    return value;
  };

  const value = parsed.value;
  let tree: Record<string, unknown>;
  const warnings: string[] = parsed.lossy ? [LOSSY_INTEGER_WARNING] : [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    const single = keys.length === 1 ? keys[0] : null;
    const singleValue = single !== null ? (value as Record<string, unknown>)[single] : undefined;
    const usable =
      single !== null &&
      !single.startsWith(options.attributePrefix) &&
      single !== options.textKey &&
      !Array.isArray(singleValue);
    tree = usable ? (prepare(value) as Record<string, unknown>) : { [rootName]: prepare(value) };
  } else if (Array.isArray(value)) {
    tree = { [rootName]: { [itemName]: prepare(value) } };
  } else {
    tree = { [rootName]: prepare(value) };
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: options.attributePrefix,
    textNodeName: options.textKey,
    format: true,
    indentBy: indentText(options.indent),
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
    processEntities: true,
  });
  let xml: string;
  try {
    xml = builder.build(tree).replace(/\n+$/, '');
  } catch (error) {
    if (error instanceof RangeError) return fail('The JSON is nested too deeply to convert.');
    return fail(error instanceof Error ? error.message : 'Could not build XML.');
  }
  if (renamed.size) {
    const list = [...renamed].slice(0, 5).map(([from, to]) => `"${from}" → <${to}>`);
    warnings.push(`${renamed.size} key${renamed.size === 1 ? ' was' : 's were'} renamed to valid XML names: ${list.join(', ')}${renamed.size > 5 ? ', …' : ''}.`);
  }
  if (strippedChars) warnings.push(`${strippedChars} control character${strippedChars === 1 ? ' was' : 's were'} removed because XML 1.0 does not allow them.`);
  if (emptyArrays) warnings.push(`${plural(emptyArrays, 'empty array')} produced no elements.`);
  const header = options.declaration ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '';
  return ok(`${header}${xml}\n`, warnings);
}

function bigintReplacer(_key: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}
