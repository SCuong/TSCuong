import { prettyPrintJson } from './response';

const VAR_RE = /\{\{\s*[^{}]+?\s*\}\}/g;

/**
 * Pretty-print a JSON request body without re-serializing it: numbers (big
 * integers, `1.0`), string escapes and key order stay exactly as typed.
 * `{{variables}}` are allowed anywhere a JSON value or string content may be
 * (e.g. `"id": {{id}}`). Returns null when the text is not valid JSON.
 */
export function formatJsonBody(raw: string): string | null {
  const vars: string[] = [];
  // A JSON number that cannot occur in the input stands in for each variable (valid inside strings too).
  const nonce = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const placeholder = (i: number) => `-1.${nonce}${String(i).padStart(5, '0')}e-9`;
  const probe = raw.replace(VAR_RE, (m) => {
    vars.push(m);
    return placeholder(vars.length - 1);
  });
  if (vars.length && raw.includes(`-1.${nonce}`)) return null;
  const pretty = prettyPrintJson(probe);
  if (pretty === null) return null;
  let out = pretty;
  vars.forEach((v, i) => {
    out = out.split(placeholder(i)).join(v);
  });
  return out;
}
