/** PEM (RFC 7468) scanning and encoding. */

import { base64ToBytes, bytesToBase64 } from '../shared-a/bytes';

export interface PemHeader {
  key: string;
  value: string;
}

export interface PemBlock {
  /** Label between BEGIN/END, e.g. "CERTIFICATE" or "PRIVATE KEY". */
  label: string;
  /** RFC 1421 style headers (e.g. `Proc-Type: 4,ENCRYPTED` in legacy encrypted keys). */
  headers: PemHeader[];
  /** Decoded contents, or null when the Base64 is invalid. */
  der: Uint8Array | null;
  /** Human readable reason when the block could not be decoded. */
  error: string | null;
  /** Character offsets of the block (BEGIN line start to END line end) within the scanned text. */
  start: number;
  end: number;
}

export interface PemScan {
  blocks: PemBlock[];
  /** Structural problems such as a BEGIN line without END line. */
  problems: string[];
  /** True when the text contains non-whitespace outside of complete PEM blocks. */
  hasStrayText: boolean;
}

const BEGIN_RE = /-----BEGIN ([A-Z0-9][A-Z0-9 #._/-]*?)-----/g;

/** Validates standard Base64 (whitespace ignored) and reports the first bad character. */
export function decodePemBase64(body: string): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const clean = body.replace(/\s+/g, '');
  if (!clean) return { ok: false, error: 'The block is empty.' };
  const bad = /[^A-Za-z0-9+/=]/.exec(clean);
  if (bad) {
    return { ok: false, error: `The Base64 contents contain an invalid character “${bad[0]}”.` };
  }
  const firstPad = clean.indexOf('=');
  if (firstPad !== -1 && !/^=+$/.test(clean.slice(firstPad))) {
    return { ok: false, error: 'The Base64 contents have “=” padding in the middle.' };
  }
  const unpadded = clean.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) {
    return { ok: false, error: 'The Base64 contents have an impossible length; the block looks truncated.' };
  }
  const bytes = base64ToBytes(clean);
  return bytes ? { ok: true, bytes } : { ok: false, error: 'The Base64 contents could not be decoded.' };
}

/** Finds every PEM block in `text` (in order), decoding their Base64 bodies. */
export function scanPem(text: string): PemScan {
  const blocks: PemBlock[] = [];
  const problems: string[] = [];
  let cursor = 0;
  let stray = '';
  BEGIN_RE.lastIndex = 0;
  for (;;) {
    BEGIN_RE.lastIndex = cursor;
    const begin = BEGIN_RE.exec(text);
    if (!begin) break;
    stray += text.slice(cursor, begin.index);
    const label = begin[1];
    const bodyStart = begin.index + begin[0].length;
    const endMarker = `-----END ${label}-----`;
    const endIndex = text.indexOf(endMarker, bodyStart);
    const nextBegin = text.indexOf('-----BEGIN ', bodyStart);
    if (endIndex === -1 || (nextBegin !== -1 && nextBegin < endIndex)) {
      const otherEnd = /-----END ([A-Z0-9][A-Z0-9 #._/-]*?)-----/.exec(text.slice(bodyStart));
      problems.push(
        otherEnd && (nextBegin === -1 || bodyStart + otherEnd.index < nextBegin)
          ? `“-----BEGIN ${label}-----” is closed by “-----END ${otherEnd[1]}-----”; the labels must match.`
          : `“-----BEGIN ${label}-----” has no matching “${endMarker}” line (the text may be truncated).`,
      );
      // Skip past this BEGIN line and keep looking for further blocks.
      cursor = bodyStart;
      continue;
    }
    const inner = text.slice(bodyStart, endIndex);
    const headers: PemHeader[] = [];
    let body = inner;
    // RFC 1421 headers: "Key: value" lines directly after BEGIN, terminated by an empty line.
    const lines = inner.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && /^[A-Za-z][A-Za-z0-9-]*:\s/.test(lines[i])) {
      while (i < lines.length && lines[i].trim() !== '') {
        const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(lines[i]);
        if (m) headers.push({ key: m[1], value: m[2].trim() });
        else if (headers.length && /^\s/.test(lines[i])) headers[headers.length - 1].value += ` ${lines[i].trim()}`;
        i++;
      }
      body = lines.slice(i).join('\n');
    }
    const decoded = decodePemBase64(body);
    blocks.push({
      label,
      headers,
      der: decoded.ok ? decoded.bytes : null,
      error: decoded.ok ? null : decoded.error,
      start: begin.index,
      end: endIndex + endMarker.length,
    });
    cursor = endIndex + endMarker.length;
  }
  stray += text.slice(cursor);
  return { blocks, problems, hasStrayText: /\S/.test(stray) };
}

/** Encodes DER bytes as a PEM block with 64-character lines. */
export function encodePem(label: string, der: Uint8Array): string {
  const b64 = bytesToBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** True when the text looks like it contains at least one PEM BEGIN line. */
export function hasPemMarker(text: string): boolean {
  return /-----BEGIN [A-Z0-9]/.test(text);
}
