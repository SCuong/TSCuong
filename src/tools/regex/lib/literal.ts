/** `/source/flags` exactly as JavaScript would print it (slashes and line breaks escaped). */
export function toRegexLiteral(pattern: string, flags: string): string {
  return String(new RegExp(pattern, flags));
}

const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/** A `new RegExp("...", "flags")` expression with the pattern as a string literal. */
export function toRegExpConstructor(pattern: string, flags: string): string {
  // JSON.stringify leaves U+2028/U+2029 raw; escape them so the code is readable everywhere.
  const source = JSON.stringify(pattern).replace(LINE_SEPARATORS, (c) => '\\u' + c.charCodeAt(0).toString(16));
  return flags ? `new RegExp(${source}, ${JSON.stringify(flags)})` : `new RegExp(${source})`;
}
