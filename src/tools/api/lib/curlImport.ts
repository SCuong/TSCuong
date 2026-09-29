import { parseCurl, CurlParseError, type ParsedCurl } from '@/tools/network/lib/curl';
import { emptyDraft, isHttpMethod, kv, rowId, type FormField, type RawLanguage, type RequestDraft } from './model';
import { parseQuery, withParamsFromUrl } from './url';

export type CurlImportResult = { ok: true; draft: RequestDraft; warnings: string[] } | { ok: false; error: string };

/** Does this text look like a curl command (used when pasting into the URL bar)? */
export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(?:\.exe)?\s/i.test(text);
}

function rawLanguageFor(contentType: string | undefined): RawLanguage {
  const ct = (contentType ?? '').toLowerCase();
  if (/[/+]json\b/.test(ct)) return 'json';
  if (/[/+]xml\b/.test(ct)) return 'xml';
  if (ct.startsWith('text/html')) return 'html';
  return 'text';
}

function decodeFormComponent(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/** Convert a parsed curl command into an editable request draft. */
export function draftFromParsedCurl(parsed: ParsedCurl): CurlImportResult {
  if (!isHttpMethod(parsed.method)) {
    return { ok: false, error: `The ${parsed.method} method is not supported here (use GET, POST, PUT, PATCH, DELETE, HEAD or OPTIONS).` };
  }
  const warnings = [...parsed.warnings];
  const draft = emptyDraft();
  draft.method = parsed.method;
  const { url, params } = withParamsFromUrl(parsed.url);
  draft.url = url;
  draft.params = params;
  draft.name = nameFromUrl(url);

  let contentType: string | undefined;
  for (const h of parsed.headers) {
    const lower = h.name.toLowerCase();
    if (lower === 'content-type') contentType = h.value;
    if (lower === 'authorization' && draft.auth.type === 'none') {
      const bearer = /^Bearer\s+(.+)$/i.exec(h.value);
      if (bearer) {
        draft.auth = { ...draft.auth, type: 'bearer', token: bearer[1].trim() };
        continue;
      }
    }
    draft.headers.push(kv(h.name, h.value));
  }
  if (parsed.auth) {
    draft.auth = { ...draft.auth, type: 'basic', username: parsed.auth.user, password: parsed.auth.password };
  }

  switch (parsed.bodyType) {
    case 'json':
    case 'raw':
      draft.body.mode = 'raw';
      draft.body.raw = parsed.body ?? '';
      draft.body.rawLanguage = parsed.bodyType === 'json' ? 'json' : rawLanguageFor(contentType);
      break;
    case 'urlencoded': {
      const text = parsed.body ?? '';
      const pairs = parseQuery(text);
      if (!pairs.length || !text.split('&').every((part) => part === '' || part.includes('='))) {
        // Not key=value pairs: keep the exact bytes as a raw body with curl's content type.
        draft.body.mode = 'raw';
        draft.body.raw = text;
        draft.body.rawLanguage = 'text';
        if (!contentType) draft.headers.push(kv('Content-Type', 'application/x-www-form-urlencoded'));
        break;
      }
      const ct = draft.headers.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ct !== -1) draft.headers.splice(ct, 1);
      draft.body.mode = 'urlencoded';
      draft.body.urlencoded = pairs.map((p) => kv(decodeFormComponent(p.key), decodeFormComponent(p.value)));
      break;
    }
    case 'multipart': {
      draft.body.mode = 'form-data';
      const ct = draft.headers.findIndex((h) => h.key.toLowerCase() === 'content-type');
      if (ct !== -1) draft.headers.splice(ct, 1);
      const needFiles: string[] = [];
      draft.body.form = parsed.formParts.map((part): FormField => {
        if (part.file !== undefined) {
          needFiles.push(part.file);
          return { id: rowId(), key: part.name, value: '', enabled: true, kind: 'file', file: null, fileName: part.filename ?? baseName(part.file) };
        }
        if (part.valueFile !== undefined) {
          warnings.push(`The value of "${part.name}" comes from the file "${part.valueFile}", which cannot be read here; it was left empty.`);
          return { id: rowId(), key: part.name, value: '', enabled: true, kind: 'text' };
        }
        return { id: rowId(), key: part.name, value: part.value ?? '', enabled: true, kind: 'text' };
      });
      if (needFiles.length) warnings.push(`Choose the file${needFiles.length === 1 ? '' : 's'} ${needFiles.join(', ')} again in the Body tab: browsers cannot read local paths.`);
      break;
    }
    case 'binary':
      draft.body.mode = 'binary';
      draft.body.binaryName = parsed.bodyFile ? baseName(parsed.bodyFile) : undefined;
      warnings.push(`Choose the body file${parsed.bodyFile ? ` (${parsed.bodyFile})` : ''} again in the Body tab: browsers cannot read local paths.`);
      break;
    case 'none':
      break;
  }

  if (parsed.maxTime && parsed.maxTime > 0) draft.timeoutMs = Math.round(parsed.maxTime * 1000);
  if (parsed.insecure) warnings.push('-k (skip TLS verification) cannot be applied: browsers and the companion always verify certificates.');
  return { ok: true, draft, warnings: dedupe(warnings.filter((w) => !/generated code uses a placeholder/.test(w))) };
}

export function draftFromCurl(command: string): CurlImportResult {
  if (!command.trim()) return { ok: false, error: 'Paste a curl command first.' };
  try {
    return draftFromParsedCurl(parseCurl(command));
  } catch (error) {
    if (error instanceof CurlParseError || error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: 'That curl command could not be read.' };
  }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** A readable default name for an imported request, e.g. "GET api.example.com/users". */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const name = `${u.host}${path}`;
    return name.length > 60 ? `${name.slice(0, 57)}...` : name;
  } catch {
    const trimmed = url.trim();
    return trimmed ? (trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed) : 'Untitled request';
  }
}
