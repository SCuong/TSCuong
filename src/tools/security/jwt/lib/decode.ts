/**
 * Parses JOSE compact tokens (JWS/JWT with 3 parts, JWE with 5 parts) without verifying them,
 * producing precise errors for malformed input and a list of security-relevant observations.
 * Time-dependent claim checks (exp/nbf/iat) live in `claims.ts`.
 */

import { analyzeBase64Url, decodeUtf8Strict, type Base64UrlAnalysis } from './base64url';
import { JWE_ENCRYPTION, OTHER_ALGORITHMS, jwsAlgorithm } from './algorithms';

export type IssueLevel = 'danger' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  message: string;
}

export type SegmentName = 'header' | 'payload' | 'signature' | 'encryptedKey' | 'iv' | 'ciphertext' | 'tag';

export const SEGMENT_LABELS: Record<SegmentName, string> = {
  header: 'Header',
  payload: 'Payload',
  signature: 'Signature',
  encryptedKey: 'Encrypted key',
  iv: 'Initialization vector',
  ciphertext: 'Ciphertext',
  tag: 'Authentication tag',
};

const JWS_SEGMENTS: SegmentName[] = ['header', 'payload', 'signature'];
const JWE_SEGMENTS: SegmentName[] = ['header', 'encryptedKey', 'iv', 'ciphertext', 'tag'];

export interface Segment {
  name: SegmentName;
  text: string;
  /** Decoded size in bytes, when the segment decodes. */
  byteLength: number | null;
}

export type PayloadView =
  | { kind: 'claims'; claims: Record<string, unknown>; text: string }
  | { kind: 'json'; value: unknown; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'binary'; bytes: Uint8Array }
  | { kind: 'detached' };

interface DecodedBase {
  /** The cleaned compact token that was decoded. */
  token: string;
  segments: Segment[];
  header: Record<string, unknown>;
  /** Header JSON exactly as decoded from the token. */
  headerText: string;
  alg: string | null;
  issues: Issue[];
  /** What was cleaned up from the input (Bearer prefix, whitespace, ...). */
  notes: string[];
}

export interface DecodedJws extends DecodedBase {
  kind: 'jws';
  payload: PayloadView;
  signature: Uint8Array;
}

export interface DecodedJwe extends DecodedBase {
  kind: 'jwe';
  enc: string | null;
}

export type DecodedToken = DecodedJws | DecodedJwe;

export type DecodeResult =
  | { ok: true; value: DecodedToken }
  | { ok: false; error: string; segments: Segment[]; notes: string[] };

export interface ExtractedToken {
  token: string;
  notes: string[];
  /** Set when the input could not be turned into a compact token at all. */
  error?: string;
}

const COMPACT_RE = /^[A-Za-z0-9_\-+/=]*(?:\.[A-Za-z0-9_\-+/=]*){2,4}$/;
const PREFERRED_JSON_KEYS = ['id_token', 'access_token', 'token', 'jwt', 'refresh_token'];

function findTokenInJson(value: unknown, depth = 0): { key: string; token: string } | null {
  if (depth > 6 || value === null || typeof value !== 'object') return null;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) =>
          (PREFERRED_JSON_KEYS.indexOf(a) + 1 || 99) - (PREFERRED_JSON_KEYS.indexOf(b) + 1 || 99),
      );
  for (const [key, v] of entries) {
    if (typeof v === 'string' && COMPACT_RE.test(v.trim()) && v.includes('.') && v.trim().length > 10) {
      return { key, token: v.trim() };
    }
  }
  for (const [, v] of entries) {
    const found = findTokenInJson(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Turns whatever was pasted (an Authorization header, a quoted string, JSON from a token
 * endpoint, a JWS JSON serialization, a token split across lines) into a compact token.
 */
export function extractToken(input: string): ExtractedToken {
  let text = input.trim();
  const notes: string[] = [];
  if (text.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { token: '', notes, error: 'This looks like JSON but does not parse, and a JWT is not JSON. Paste the token itself (three parts separated by dots).' };
    }
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const obj = json as Record<string, unknown>;
      const sig = Array.isArray(obj.signatures) ? (obj.signatures[0] as Record<string, unknown> | undefined) : obj;
      if (sig && typeof obj.payload === 'string' && typeof sig.signature === 'string') {
        if (typeof sig.protected !== 'string') {
          return { token: '', notes, error: 'This JWS JSON serialization has no protected header, so it has no compact form to decode.' };
        }
        notes.push(
          Array.isArray(obj.signatures)
            ? `Converted the first of ${obj.signatures.length} signatures in the JWS JSON serialization to compact form.`
            : 'Converted the flattened JWS JSON serialization to compact form.',
        );
        if (sig.header) notes.push('The unprotected “header” member is not part of the compact form and was ignored.');
        return { token: `${sig.protected}.${obj.payload}.${sig.signature}`, notes };
      }
      if (typeof obj.ciphertext === 'string' && typeof obj.protected === 'string') {
        notes.push('Converted the flattened JWE JSON serialization to compact form.');
        return {
          token: [obj.protected, obj.encrypted_key ?? '', obj.iv ?? '', obj.ciphertext, obj.tag ?? ''].join('.'),
          notes,
        };
      }
    }
    const found = findTokenInJson(json);
    if (!found) return { token: '', notes, error: 'This JSON does not contain anything that looks like a JWT.' };
    notes.push(`Decoded the “${found.key}” value from the JSON you pasted.`);
    text = found.token;
  }
  const header = /^authorization\s*:\s*/i.exec(text);
  if (header) {
    text = text.slice(header[0].length).trim();
    notes.push('Removed the “Authorization:” header name.');
  }
  const bearer = /^(?:bearer|jwt|dpop)\s+/i.exec(text);
  if (bearer) {
    text = text.slice(bearer[0].length).trim();
    notes.push(`Removed the “${bearer[0].trim()}” prefix.`);
  }
  const quoted = /^(["'`])([\s\S]*)\1[,;]?$/.exec(text);
  if (quoted) {
    text = quoted[2].trim();
    notes.push('Removed surrounding quotes.');
  }
  if (/\s/.test(text)) {
    text = text.replace(/\s+/g, '');
    notes.push('Removed spaces and line breaks inside the token.');
  }
  return { token: text, notes };
}

/** Replaces control characters with a middle dot so previews stay on one readable line. */
function visibleControls(text: string): string {
  let out = '';
  for (const ch of text) out += ch.charCodeAt(0) < 32 ? '·' : ch;
  return out;
}

function describeJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'a boolean';
  return typeof value;
}

function ordinal(index: number): string {
  return `part ${index + 1}`;
}

function partName(name: SegmentName, index: number): string {
  return `The ${SEGMENT_LABELS[name].toLowerCase()} (${ordinal(index)})`;
}

/** Explains why a segment is not decodable Base64URL, or returns null when it decodes. */
function base64Error(name: SegmentName, index: number, analysis: Base64UrlAnalysis, text: string): string | null {
  if (analysis.invalid) {
    const { char, index: pos } = analysis.invalid;
    const shown = /\s/.test(char) ? 'a whitespace character' : `“${char}”`;
    return `${partName(name, index)} contains ${shown} at character ${pos + 1}, which is not allowed in Base64URL (only A–Z, a–z, 0–9, “-” and “_”).`;
  }
  if (analysis.badLength) {
    return `${partName(name, index)} has an impossible Base64URL length (${text.replace(/=+$/, '').length} characters, one more than a multiple of 4). It was probably cut off while copying.`;
  }
  return null;
}

function base64Warnings(name: SegmentName, index: number, analysis: Base64UrlAnalysis, issues: Issue[]) {
  const who = partName(name, index);
  if (analysis.padded) {
    issues.push({ level: 'warning', message: `${who} ends with “=” padding. JOSE compact tokens must not be padded, so strict libraries reject this token.` });
  }
  if (analysis.standardAlphabet) {
    issues.push({ level: 'warning', message: `${who} uses “+” or “/” from standard Base64 instead of Base64URL “-” and “_”. Strict libraries reject this token.` });
  }
  if (analysis.nonCanonical) {
    issues.push({ level: 'info', message: `${who} has non-zero unused bits in its last character (non-canonical Base64URL). Some libraries reject this.` });
  }
}

/** Keys that appear more than once in the same JSON object (JSON.parse silently keeps the last). */
export function findDuplicateKeys(json: string): string[] {
  const duplicates = new Set<string>();
  const stack: Array<{ keys: Set<string>; expectKey: boolean } | null> = [];
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') j += json[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.expectKey) {
        let key: string;
        try {
          key = JSON.parse(json.slice(i, j + 1)) as string;
        } catch {
          key = json.slice(i + 1, j);
        }
        if (top.keys.has(key)) duplicates.add(key);
        else top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (ch === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (ch === '[') stack.push(null);
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',') {
      const top = stack[stack.length - 1];
      if (top) top.expectKey = true;
    }
  }
  return [...duplicates];
}

const SENSITIVE_KEY = /pass(?:word|wd|phrase)?$|^pwd$|secret|ssn$|social.?security|credit.?card|card.?number|^cvv$|^cvc$|private.?key|api.?key/i;

/** Parses the JSON header of a token. */
function parseHeader(text: string, index: number): { ok: true; header: Record<string, unknown>; text: string } | { ok: false; error: string } {
  const analysis = analyzeBase64Url(text);
  if (text === '') return { ok: false, error: `${partName('header', index)} is empty.` };
  const b64 = base64Error('header', index, analysis, text);
  if (b64) return { ok: false, error: b64 };
  const decoded = decodeUtf8Strict(analysis.bytes!);
  if (decoded === null) {
    return { ok: false, error: `${partName('header', index)} is not UTF-8 text after Base64URL decoding, so it cannot be a JSON header.` };
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch (e) {
    const reason = e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'syntax error';
    const preview = decoded.length > 60 ? `${decoded.slice(0, 60)}…` : decoded;
    return {
      ok: false,
      error: `${partName('header', index)} decodes to “${visibleControls(preview)}”, which is not valid JSON (${reason}).`,
    };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${partName('header', index)} must be a JSON object, but it is ${describeJsonType(value)}.` };
  }
  return { ok: true, header: value as Record<string, unknown>, text: decoded };
}

function algorithmIssues(header: Record<string, unknown>, signature: Uint8Array | null, issues: Issue[]): string | null {
  const alg = header.alg;
  if (alg === undefined) {
    issues.push({ level: 'danger', message: 'The header has no “alg” parameter. Verifiers must reject a token that does not name its algorithm.' });
    return null;
  }
  if (typeof alg !== 'string') {
    issues.push({ level: 'danger', message: `The “alg” header must be a string, but it is ${describeJsonType(alg)}.` });
    return null;
  }
  if (alg.toLowerCase() === 'none') {
    issues.push({
      level: 'danger',
      message:
        alg === 'none'
          ? 'alg is “none”: this token is unsecured, so anyone can create or change it. Never accept alg “none” in production.'
          : `alg is “${alg}”, a case variation of “none” used to slip past naive checks. Treat this token as forged.`,
    });
    if (signature && signature.length > 0) {
      issues.push({ level: 'warning', message: 'The token claims to be unsecured (alg “none”) but still carries a signature part.' });
    }
    return alg;
  }
  if (signature && signature.length === 0) {
    issues.push({ level: 'danger', message: `The signature part is empty, so the token is unsigned even though alg is “${alg}”.` });
  }
  const info = jwsAlgorithm(alg);
  if (!info) {
    if (OTHER_ALGORITHMS[alg] && /KW$|^RSA-OAEP|^RSA1_5$|^dir$|^ECDH-ES/.test(alg)) {
      issues.push({ level: 'warning', message: `“${alg}” is a JWE key-management algorithm, not a signature algorithm, but this token has 3 parts like a JWS.` });
    } else if (!OTHER_ALGORITHMS[alg]) {
      issues.push({ level: 'warning', message: `Unknown algorithm “${alg}”. Standard JWS algorithms are HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA.` });
    }
    return alg;
  }
  if (signature && signature.length > 0) {
    if (info.family === 'ECDSA' && info.signatureBytes && signature.length !== info.signatureBytes) {
      const looksDer = signature[0] === 0x30 && signature.length >= 8 && signature.length <= info.signatureBytes + 9;
      issues.push({
        level: 'warning',
        message: looksDer
          ? `The ${alg} signature is ${signature.length} bytes and looks DER-encoded (ASN.1). JWS requires the raw ${info.signatureBytes}-byte R‖S form, so standard libraries will reject it.`
          : `The ${alg} signature is ${signature.length} bytes, but ${alg} signatures are always ${info.signatureBytes} bytes.`,
      });
    } else if (info.signatureBytes && signature.length !== info.signatureBytes) {
      issues.push({
        level: 'warning',
        message: `The ${alg} signature is ${signature.length} bytes, but ${alg} ${info.family === 'HMAC' ? 'MACs' : 'signatures'} are ${info.signatureBytes} bytes.`,
      });
    } else if ((info.family === 'RSA' || info.family === 'RSA-PSS') && signature.length < 256) {
      issues.push({
        level: 'warning',
        message: `The RSA signature is ${signature.length} bytes, which means the signing key is only ${signature.length * 8} bits. Keys under 2048 bits are considered insecure and many libraries reject them.`,
      });
    }
  }
  return alg;
}

function headerIssues(header: Record<string, unknown>, issues: Issue[]) {
  const { typ, cty, jku, x5u, jwk, x5c, kid, crit } = header;
  if (typ !== undefined && typeof typ !== 'string') {
    issues.push({ level: 'warning', message: `“typ” should be a string, but it is ${describeJsonType(typ)}.` });
  }
  if (typeof cty === 'string' && cty.toUpperCase() === 'JWT') {
    issues.push({ level: 'info', message: 'cty is “JWT”: the payload is a nested token (for example signed, then encrypted).' });
  }
  if (typeof jku === 'string' || typeof x5u === 'string') {
    const which = typeof jku === 'string' ? 'jku' : 'x5u';
    issues.push({
      level: 'warning',
      message: `The header points to a key URL (${which}). Verifiers must never fetch keys from a URL chosen by the token unless it is on an allow-list; attackers use this to supply their own key.`,
    });
  }
  if (jwk !== undefined) {
    issues.push({
      level: 'warning',
      message: 'The header embeds its own key (jwk). A signature checked with a key the token supplies itself proves nothing unless that exact key is independently trusted.',
    });
  }
  if (x5c !== undefined) {
    issues.push({ level: 'info', message: 'The header carries a certificate chain (x5c). Its key is only trustworthy after the chain is validated against a trusted root.' });
  }
  if (typeof kid === 'string' && (kid.includes('\0') || /\.\.[\\/]|['";|`]|^\/|\$\(/.test(kid))) {
    issues.push({
      level: 'warning',
      message: `The key ID “${kid}” contains path or quote characters. Make sure the server never uses kid in file paths, shell commands or SQL (a known JWT attack).`,
    });
  }
  if (kid !== undefined && typeof kid !== 'string') {
    issues.push({ level: 'warning', message: `“kid” should be a string, but it is ${describeJsonType(kid)}.` });
  }
  if (crit !== undefined) {
    const list = Array.isArray(crit) ? crit.map(String).join(', ') : String(crit);
    issues.push({ level: 'info', message: `The header marks extensions as critical (crit: ${list}). Verifiers that do not understand them must reject the token.` });
  }
}

function decodePayload(text: string, header: Record<string, unknown>, index: number, issues: Issue[]): { ok: true; payload: PayloadView } | { ok: false; error: string } {
  if (header.b64 === false) {
    issues.push({ level: 'info', message: 'b64 is false: the payload is sent as-is, not Base64URL-encoded (RFC 7797).' });
    return { ok: true, payload: { kind: 'text', text } };
  }
  if (text === '') return { ok: true, payload: { kind: 'detached' } };
  const analysis = analyzeBase64Url(text);
  const b64 = base64Error('payload', index, analysis, text);
  if (b64) return { ok: false, error: b64 };
  base64Warnings('payload', index, analysis, issues);
  const bytes = analysis.bytes!;
  const decoded = decodeUtf8Strict(bytes);
  if (decoded === null) {
    issues.push({ level: 'info', message: 'The payload is binary data rather than text, so this is a JWS but not a JWT.' });
    return { ok: true, payload: { kind: 'binary', bytes } };
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch (e) {
    if (/^\s*[{[]/.test(decoded)) {
      const reason = e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'syntax error';
      issues.push({ level: 'danger', message: `The payload looks like JSON but does not parse (${reason}). JWT claims must be a valid JSON object.` });
    } else {
      issues.push({ level: 'info', message: 'The payload is plain text, not JSON: this is a JWS but not a JWT.' });
    }
    return { ok: true, payload: { kind: 'text', text: decoded } };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ level: 'warning', message: `The payload is JSON ${describeJsonType(value)}, but a JWT claims set must be a JSON object.` });
    return { ok: true, payload: { kind: 'json', value, text: decoded } };
  }
  const dup = findDuplicateKeys(decoded);
  if (dup.length) {
    issues.push({
      level: 'warning',
      message: `The payload repeats ${dup.map((k) => `“${k}”`).join(', ')}. Parsers disagree about which value wins, which attackers can exploit.`,
    });
  }
  const sensitive = Object.keys(value).filter((k) => SENSITIVE_KEY.test(k));
  if (sensitive.length) {
    issues.push({
      level: 'warning',
      message: `The payload has a field named ${sensitive.map((k) => `“${k}”`).join(', ')}. JWT payloads are only encoded, not encrypted: anyone holding the token can read them.`,
    });
  }
  return { ok: true, payload: { kind: 'claims', claims: value as Record<string, unknown>, text: decoded } };
}

const LEVEL_ORDER: Record<IssueLevel, number> = { danger: 0, warning: 1, info: 2 };

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** Decodes a compact JWS/JWT or JWE. Returns null for empty input. */
export function decodeToken(input: string): DecodeResult | null {
  if (!input.trim()) return null;
  const extracted = extractToken(input);
  const notes = extracted.notes;
  if (extracted.error) return { ok: false, error: extracted.error, segments: [], notes };
  const token = extracted.token;
  const parts = token.split('.');
  const names = parts.length === 5 ? JWE_SEGMENTS : JWS_SEGMENTS;
  const segments: Segment[] = parts.map((text, i) => {
    const a = analyzeBase64Url(text);
    return { name: names[i] ?? 'signature', text, byteLength: a.bytes ? a.bytes.length : null };
  });

  if (parts.length === 1) {
    const whole = analyzeBase64Url(token);
    const text = whole.bytes ? decodeUtf8Strict(whole.bytes) : null;
    const looksJson = text !== null && /^\s*\{/.test(text);
    return {
      ok: false,
      error: looksJson
        ? 'This is a single Base64URL-encoded JSON object, not a whole JWT. A JWT has three parts separated by dots: header.payload.signature.'
        : 'This is not a JWT: it contains no dots. A JWT has three Base64URL parts separated by dots: header.payload.signature.',
      segments: [],
      notes,
    };
  }
  if (parts.length === 2) {
    return {
      ok: false,
      error: 'Only 2 parts were found. A signed JWT has 3 parts (header.payload.signature); even an unsecured token with alg “none” ends with a trailing dot.',
      segments,
      notes,
    };
  }
  if (parts.length !== 3 && parts.length !== 5) {
    return {
      ok: false,
      error: `Found ${parts.length} parts separated by dots. A JWT has 3 parts when signed (JWS) or 5 parts when encrypted (JWE).`,
      segments,
      notes,
    };
  }

  const headerResult = parseHeader(parts[0], 0);
  if (!headerResult.ok) return { ok: false, error: headerResult.error, segments, notes };
  const { header, text: headerText } = headerResult;
  const issues: Issue[] = [];
  base64Warnings('header', 0, analyzeBase64Url(parts[0]), issues);
  const headerDupes = findDuplicateKeys(headerText);
  if (headerDupes.length) {
    issues.push({
      level: 'warning',
      message: `The header repeats ${headerDupes.map((k) => `“${k}”`).join(', ')}. Parsers disagree about which value wins; a repeated “alg” is a known attack.`,
    });
  }

  if (parts.length === 5) {
    for (let i = 1; i < 5; i++) {
      const a = analyzeBase64Url(parts[i]);
      const err = base64Error(names[i], i, a, parts[i]);
      if (err) return { ok: false, error: err, segments, notes };
      base64Warnings(names[i], i, a, issues);
    }
    const alg = typeof header.alg === 'string' ? header.alg : null;
    const enc = typeof header.enc === 'string' ? header.enc : null;
    if (!alg) issues.push({ level: 'danger', message: 'The JWE header has no “alg” (key management algorithm).' });
    if (!enc) issues.push({ level: 'danger', message: 'The JWE header has no “enc” (content encryption algorithm).' });
    else if (!JWE_ENCRYPTION[enc]) issues.push({ level: 'warning', message: `Unknown content encryption algorithm “${enc}”.` });
    if (alg === 'RSA1_5') {
      issues.push({ level: 'warning', message: 'RSA1_5 key encryption is deprecated because of padding-oracle attacks; prefer RSA-OAEP-256 or ECDH-ES.' });
    }
    if (parts[3] === '') issues.push({ level: 'danger', message: 'The ciphertext (part 4) is empty.' });
    if (header.zip !== undefined) {
      issues.push({ level: 'info', message: 'The content is compressed before encryption (zip). Compressing secrets alongside attacker-controlled data can leak information.' });
    }
    headerIssues(header, issues);
    return { ok: true, value: { kind: 'jwe', token, segments, header, headerText, alg, enc, issues: sortIssues(issues), notes } };
  }

  const sigAnalysis = analyzeBase64Url(parts[2]);
  const sigError = base64Error('signature', 2, sigAnalysis, parts[2]);
  if (sigError) return { ok: false, error: sigError, segments, notes };
  const payloadResult = decodePayload(parts[1], header, 1, issues);
  if (!payloadResult.ok) return { ok: false, error: payloadResult.error, segments, notes };
  base64Warnings('signature', 2, sigAnalysis, issues);
  const signature = sigAnalysis.bytes!;
  const alg = algorithmIssues(header, signature, issues);
  headerIssues(header, issues);
  if (payloadResult.payload.kind === 'detached') {
    issues.push({
      level: 'info',
      message: 'The payload part is empty: this is a JWS with a detached payload (RFC 7515 Appendix F), so there are no claims to show.',
    });
  }
  if (token.length > 8192) {
    issues.push({ level: 'info', message: `The token is ${Math.round(token.length / 1024)} KB. Many servers and proxies limit request headers to 8 KB.` });
  }
  return {
    ok: true,
    value: { kind: 'jws', token, segments, header, headerText, alg, payload: payloadResult.payload, signature, issues: sortIssues(issues), notes },
  };
}
