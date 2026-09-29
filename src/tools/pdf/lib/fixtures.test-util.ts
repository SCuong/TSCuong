import { createHash } from 'node:crypto';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  StandardFonts,
  degrees,
  type PDFObject,
} from 'pdf-lib';

/** Build a small PDF in memory for tests. Page i (0-based) is (200 + i) × 300 pt so tests can identify it by width. */
export async function makePdf(
  pageCount: number,
  options: { title?: string; rotate?: Record<number, number>; sizes?: Array<[number, number]> } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const size = options.sizes?.[i] ?? [200 + i, 300];
    const page = doc.addPage(size as [number, number]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 18, font });
    const r = options.rotate?.[i];
    if (r) page.setRotation(degrees(r));
  }
  if (options.title) doc.setTitle(options.title);
  return doc.save();
}

/** Page identities (0-based source index, from the width) in document order. */
export async function pageIds(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getMediaBox().width) - 200);
}

export async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

// ---------------------------------------------------------------------------
// Encrypted fixtures: the standard security handler, revision 3 (RC4, 128-bit).

const PAD = Uint8Array.from(
  '28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A'.match(/../g)!.map((h) => parseInt(h, 16)),
);

function md5(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const padPassword = (pw: string) => {
  const out = new Uint8Array(32);
  const b = new TextEncoder().encode(pw).slice(0, 32);
  out.set(b);
  out.set(PAD.subarray(0, 32 - b.length), b.length);
  return out;
};
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const xorKey = (key: Uint8Array, n: number) => key.map((b) => b ^ n);

/**
 * Encrypt a PDF saved without object streams (RC4 128-bit, like older Acrobat versions), so
 * tests can check what the tools do with protected input. `perms` is the /P value.
 */
export async function encryptRc4(bytes: Uint8Array, userPassword: string, ownerPassword: string, perms = -3904): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const id = md5(new TextEncoder().encode(`fixture-${userPassword}-${ownerPassword}`));
  let h = md5(padPassword(ownerPassword || userPassword));
  for (let i = 0; i < 50; i++) h = md5(h.subarray(0, 16));
  const ownerKey = h.subarray(0, 16);
  let o = rc4(ownerKey, padPassword(userPassword));
  for (let i = 1; i <= 19; i++) o = rc4(xorKey(ownerKey, i), o);
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, perms, true);
  let k = md5(padPassword(userPassword), o, p, id);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16));
  const key = k.subarray(0, 16);
  let u = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) u = rc4(xorKey(key, i), u);
  const objectKey = (num: number, gen: number) =>
    md5(key, Uint8Array.of(num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255)).subarray(0, 16);
  const encryptValue = (value: PDFObject, okey: Uint8Array): PDFObject => {
    if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.of(toHex(rc4(okey, value.asBytes())));
    if (value instanceof PDFDict) {
      for (const [name, v] of value.entries()) value.set(name, encryptValue(v, okey));
    } else if (value instanceof PDFArray) {
      for (let i = 0; i < value.size(); i++) value.set(i, encryptValue(value.get(i), okey));
    }
    return value;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const okey = objectKey(ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFRawStream) {
      encryptValue(obj.dict, okey);
      ctx.assign(ref, PDFRawStream.of(obj.dict, rc4(okey, obj.contents)));
    } else {
      encryptValue(obj, okey);
    }
  }
  const encrypt = ctx.obj({ Filter: 'Standard', V: 2, R: 3, Length: 128, P: PDFNumber.of(perms) });
  encrypt.set(PDFName.of('O'), PDFHexString.of(toHex(o)));
  encrypt.set(PDFName.of('U'), PDFHexString.of(toHex(new Uint8Array([...u, ...new Uint8Array(16)]))));
  ctx.trailerInfo.Encrypt = ctx.register(encrypt);
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(toHex(id)), PDFHexString.of(toHex(id))]);
  return doc.save({ useObjectStreams: false });
}
