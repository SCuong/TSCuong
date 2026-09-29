/**
 * Pure pdf-lib operations. They run inside the PDF worker (see pdf.worker.ts)
 * and, as a fallback, on the main thread. Every operation takes plain,
 * structured-cloneable arguments and returns bytes or plain data.
 * Page indices in this module are 0-based.
 */
import {
  PDFArray,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  TextRenderingMode,
  beginText,
  degrees,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  rotateAndSkewTextDegreesAndTranslate,
  setCharacterSqueeze,
  setFontAndSize,
  setTextRenderingMode,
  showText,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { zlibSync } from 'fflate';
import { PdfError, toPdfError } from './errors';
import { looksEncrypted } from './bytes';
import {
  anchorCenter,
  insetBox,
  normalizeRotation,
  originForCenteredRotation,
  rotatedBounds,
  tileCenters,
  visualMarginsToUser,
  visualSize,
  visualToUser,
  type Box,
  type Margins,
  type Position,
} from './geometry';
import { infoDict, removeAllMetadata, writeMetadata, type MetadataFields } from './metadata';

export interface OpContext {
  progress: (fraction: number, label?: string) => void;
  /** Throws when the job was cancelled (main-thread fallback only; workers are terminated instead). */
  checkCancelled: () => void;
}

export const noopContext: OpContext = { progress: () => {}, checkCancelled: () => {} };

const PRODUCER = 'LocalKit (pdf-lib)';

// ---------------------------------------------------------------------------
// Loading and saving

export async function loadDoc(bytes: Uint8Array, ignoreEncryption = false, fileName?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption, updateMetadata: false, throwOnInvalidObject: false });
  } catch (error) {
    const e = toPdfError(error, fileName);
    // pdf-lib cannot decrypt, so encrypted object streams look like damage to it. Say what is really going on.
    if (e.kind === 'corrupt' && looksEncrypted(bytes)) {
      throw new PdfError(
        'encrypted',
        `${fileName ? `"${fileName}"` : 'This PDF'} is encrypted in a way the in-browser PDF editor cannot read. Remove the protection in your PDF app first, then try again.`,
      );
    }
    throw e;
  }
}

async function newDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer(PRODUCER);
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc;
}

export function isEncryptedDoc(doc: PDFDocument): boolean {
  return Boolean(doc.context.trailerInfo.Encrypt);
}

async function save(doc: PDFDocument, useObjectStreams = true): Promise<Uint8Array> {
  // An edited encrypted file keeps its /Encrypt dictionary, /ID and object numbers, so it stays
  // readable with the original password — but only without object streams: objects packed into
  // a new object stream (including the /Encrypt dictionary itself) would be "decrypted" by
  // readers into garbage, and the whole file would ask for a password it never had.
  return doc.save({
    useObjectStreams: useObjectStreams && !isEncryptedDoc(doc),
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
}

function touch(doc: PDFDocument) {
  doc.setModificationDate(new Date());
}

/** Copy title/author/subject/keywords/creator (not dates/producer) into a new document. */
function copyInfo(from: PDFDocument, to: PDFDocument) {
  const src = infoDict(from);
  if (!src) return;
  const dst = infoDict(to, true)!;
  for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator']) {
    const value = src.lookup(PDFName.of(key));
    if (value) dst.set(PDFName.of(key), value.clone(to.context));
  }
}

function checkIndices(indices: number[], count: number) {
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      throw new PdfError('invalid-input', `Page ${i + 1} does not exist: the document has ${count} pages.`);
    }
  }
}

/**
 * Wrap a page's existing content in q/Q so that graphics state it leaves behind
 * (e.g. an unbalanced transform) does not affect what we draw on top.
 */
function isolateExistingContent(doc: PDFDocument, page: PDFPage) {
  page.node.normalize();
  const start = doc.context.register(PDFContentStream.of(doc.context.obj({}), [pushGraphicsState()]));
  const end = doc.context.register(PDFContentStream.of(doc.context.obj({}), [popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
}

function boxOf(page: PDFPage): Box {
  const b = page.getCropBox();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

// ---------------------------------------------------------------------------
// Merge / split / select / organize

export interface MergeInput {
  bytes: Uint8Array;
  name: string;
  /** 0-based pages in output order; omit for all pages. */
  pages?: number[];
}

export async function merge(
  args: { files: MergeInput[]; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  if (args.files.length === 0) throw new PdfError('invalid-input', 'Add at least one PDF to merge.');
  const out = await newDoc();
  const total = args.files.reduce((n, f) => n + (f.pages?.length ?? 1), 0);
  let done = 0;
  for (let i = 0; i < args.files.length; i++) {
    const file = args.files[i];
    ctx.checkCancelled();
    ctx.progress(done / Math.max(total, 1), `Reading ${file.name}`);
    const src = await loadDoc(file.bytes, args.ignoreEncryption, file.name);
    if (i === 0) copyInfo(src, out);
    const indices = file.pages ?? src.getPageIndices();
    checkIndices(indices, src.getPageCount());
    // Copy in batches so progress is visible for big files.
    for (let start = 0; start < indices.length; start += 25) {
      ctx.checkCancelled();
      const batch = indices.slice(start, start + 25);
      const pages = await out.copyPages(src, batch);
      for (const page of pages) out.addPage(page);
      done += file.pages ? batch.length : batch.length / indices.length;
      ctx.progress(done / Math.max(total, 1), `Merging ${file.name}`);
    }
  }
  ctx.progress(0.98, 'Saving');
  return save(out);
}

/** Split into several documents, one per group of 0-based page indices. */
export async function split(
  args: { bytes: Uint8Array; groups: number[][]; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array[]> {
  const src = await loadDoc(args.bytes, args.ignoreEncryption);
  const count = src.getPageCount();
  const results: Uint8Array[] = [];
  for (let g = 0; g < args.groups.length; g++) {
    ctx.checkCancelled();
    const group = args.groups[g];
    if (group.length === 0) continue;
    checkIndices(group, count);
    ctx.progress(g / args.groups.length, `Creating file ${g + 1} of ${args.groups.length}`);
    const out = await newDoc();
    copyInfo(src, out);
    const pages = await out.copyPages(src, group);
    for (const page of pages) out.addPage(page);
    results.push(await save(out));
  }
  return results;
}

/** A new document with the given pages (in the given order). Used by Extract and Delete. */
export async function selectPages(
  args: { bytes: Uint8Array; pages: number[]; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  if (args.pages.length === 0) throw new PdfError('invalid-input', 'The result would have no pages.');
  const [bytes] = await split({ bytes: args.bytes, groups: [args.pages], ignoreEncryption: args.ignoreEncryption }, ctx);
  return bytes;
}

export type OrganizeItem =
  | { kind: 'page'; source: number; index: number; rotate: number }
  | { kind: 'blank'; width: number; height: number };

/** Build a document from pages of one or more sources, with per-page extra rotation and blank pages. */
export async function organize(
  args: { sources: Uint8Array[]; items: OrganizeItem[]; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  if (args.items.length === 0) throw new PdfError('invalid-input', 'The document must keep at least one page.');
  const docs: PDFDocument[] = [];
  for (let i = 0; i < args.sources.length; i++) {
    ctx.progress(0, 'Reading documents');
    docs.push(await loadDoc(args.sources[i], args.ignoreEncryption));
  }
  const out = await newDoc();
  if (docs[0]) copyInfo(docs[0], out);
  // Copy all needed pages per source in one call (shared resources are copied once).
  const copied = new Map<string, PDFPage>();
  for (let s = 0; s < docs.length; s++) {
    const needed = [...new Set(args.items.flatMap((it) => (it.kind === 'page' && it.source === s ? [it.index] : [])))];
    if (!needed.length) continue;
    checkIndices(needed, docs[s].getPageCount());
    const pages = await out.copyPages(docs[s], needed);
    needed.forEach((idx, k) => copied.set(`${s}:${idx}`, pages[k]));
  }
  const used = new Set<string>();
  for (let i = 0; i < args.items.length; i++) {
    ctx.checkCancelled();
    const item = args.items[i];
    if (item.kind === 'blank') {
      out.addPage([item.width, item.height]);
    } else {
      const key = `${item.source}:${item.index}`;
      let page = copied.get(key)!;
      if (used.has(key)) {
        // Duplicated page: copy it again so each occurrence can have its own rotation.
        [page] = await out.copyPages(docs[item.source], [item.index]);
      }
      used.add(key);
      if (item.rotate) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + item.rotate)));
      out.addPage(page);
    }
    if (i % 20 === 0) ctx.progress(i / args.items.length, 'Arranging pages');
  }
  ctx.progress(0.97, 'Saving');
  return save(out);
}

// ---------------------------------------------------------------------------
// In-place page edits

export async function rotate(
  args: { bytes: Uint8Array; pages: number[]; angle: number; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  const pages = doc.getPages();
  checkIndices(args.pages, pages.length);
  for (const i of args.pages) {
    const page = pages[i];
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + args.angle)));
  }
  ctx.progress(0.9, 'Saving');
  touch(doc);
  return save(doc);
}

export interface CropArgs {
  bytes: Uint8Array;
  pages: number[];
  /** Margins in points, measured on the page as displayed. */
  margins: Margins;
  /** Also set the MediaBox (a permanent crop) instead of only the CropBox. */
  setMediaBox?: boolean;
  ignoreEncryption?: boolean;
}

export async function crop(args: CropArgs, ctx: OpContext = noopContext): Promise<Uint8Array> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  const pages = doc.getPages();
  checkIndices(args.pages, pages.length);
  for (const i of args.pages) {
    const page = pages[i];
    const box = boxOf(page);
    const m = visualMarginsToUser(args.margins, page.getRotation().angle);
    const next = insetBox(box, m);
    if (!next) {
      throw new PdfError('invalid-input', `The margins are larger than page ${i + 1} (${Math.round(box.width)} × ${Math.round(box.height)} pt).`);
    }
    page.setCropBox(next.x, next.y, next.width, next.height);
    if (args.setMediaBox) {
      page.setMediaBox(next.x, next.y, next.width, next.height);
      // Keep the other boxes inside the new MediaBox.
      for (const name of ['BleedBox', 'TrimBox', 'ArtBox']) page.node.delete(PDFName.of(name));
    }
  }
  ctx.progress(0.9, 'Saving');
  touch(doc);
  return save(doc);
}

// ---------------------------------------------------------------------------
// Page numbers and watermarks

export type NumberPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface PageNumberOptions {
  bytes: Uint8Array;
  /** 0-based pages that receive a number, in document order. */
  pages: number[];
  position: NumberPosition;
  /**
   * "{n}" is replaced with the number, "{total}" with the last number; a width such as
   * "{n:6}" zero-pads (Bates numbering: "ABC{n:6}" → "ABC000042").
   */
  format: string;
  fontSize: number;
  /** Distance from the page edges, in points. */
  margin: number;
  startNumber: number;
  color: [number, number, number];
  ignoreEncryption?: boolean;
}

/** Matches {n}, {total} and zero-padded forms like {n:6} (width 1–20). */
const PAGE_TOKEN = /\{(n|total)(?::(\d{1,2}))?\}/gi;

/** Whether a page-number format contains the page number token ({n} or {n:width}). */
export function hasPageToken(format: string): boolean {
  return /\{n(?::\d{1,2})?\}/i.test(format);
}

export function formatPageNumber(format: string, n: number, total: number): string {
  return format.replace(PAGE_TOKEN, (_match, name: string, width?: string) => {
    const value = String(name.toLowerCase() === 'n' ? n : total);
    const pad = width ? Math.min(Number(width), 20) : 0;
    return pad > value.length ? value.padStart(pad, '0') : value;
  });
}

/** Replace characters the font cannot draw; throws with a clear message if any exist. */
function assertEncodable(font: PDFFont, text: string) {
  try {
    font.encodeText(text);
  } catch (error) {
    throw toPdfError(error);
  }
}

export async function addPageNumbers(args: PageNumberOptions, ctx: OpContext = noopContext): Promise<Uint8Array> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  const pages = doc.getPages();
  checkIndices(args.pages, pages.length);
  const sorted = [...args.pages].sort((a, b) => a - b);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const last = args.startNumber + sorted.length - 1;
  assertEncodable(font, formatPageNumber(args.format, last, last));
  const color = rgb(...args.color);
  sorted.forEach((index, k) => {
    if (k % 25 === 0) {
      ctx.checkCancelled();
      ctx.progress(k / sorted.length, 'Numbering pages');
    }
    const page = pages[index];
    const text = formatPageNumber(args.format, args.startNumber + k, last);
    const box = boxOf(page);
    const r = page.getRotation().angle;
    const { width: pw, height: ph } = visualSize(box, r);
    const tw = font.widthOfTextAtSize(text, args.fontSize);
    const capHeight = font.heightAtSize(args.fontSize, { descender: false });
    const { cx, cy } = anchorCenter(args.position, tw, capHeight, pw, ph, args.margin);
    const o = visualToUser(cx - tw / 2, cy - capHeight / 2, box, r);
    isolateExistingContent(doc, page);
    page.drawText(text, { x: o.x, y: o.y, size: args.fontSize, font, color, rotate: degrees(normalizeRotation(r)) });
  });
  ctx.progress(0.95, 'Saving');
  touch(doc);
  return save(doc);
}

export interface TextWatermark {
  kind: 'text';
  text: string;
  fontSize: number;
  color: [number, number, number];
  bold: boolean;
}

export interface ImageWatermark {
  kind: 'image';
  bytes: Uint8Array;
  format: 'png' | 'jpg';
  /** Width as a fraction of the page width (0–1). */
  scale: number;
}

export interface WatermarkOptions {
  bytes: Uint8Array;
  pages: number[];
  mark: TextWatermark | ImageWatermark;
  /** 0–1 */
  opacity: number;
  /** Counter-clockwise degrees, as seen on the page. */
  angle: number;
  position: Position;
  tile: boolean;
  /** Margin from the page edge for non-center positions, in points. */
  margin: number;
  ignoreEncryption?: boolean;
}

export async function addWatermark(args: WatermarkOptions, ctx: OpContext = noopContext): Promise<Uint8Array> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  const pages = doc.getPages();
  checkIndices(args.pages, pages.length);
  const mark = args.mark;
  let font: PDFFont | null = null;
  let image: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (mark.kind === 'text') {
    if (!mark.text.trim()) throw new PdfError('invalid-input', 'Enter the watermark text.');
    font = await doc.embedFont(mark.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    assertEncodable(font, mark.text);
  } else {
    try {
      image = mark.format === 'png' ? await doc.embedPng(mark.bytes) : await doc.embedJpg(mark.bytes);
    } catch {
      throw new PdfError('invalid-input', 'The watermark image could not be read. Use a PNG or JPEG file.');
    }
  }

  for (let k = 0; k < args.pages.length; k++) {
    if (k % 20 === 0) {
      ctx.checkCancelled();
      ctx.progress(k / args.pages.length, 'Adding watermark');
    }
    const page = pages[args.pages[k]];
    const box = boxOf(page);
    const r = page.getRotation().angle;
    const { width: pw, height: ph } = visualSize(box, r);

    let w: number;
    let h: number;
    if (font && mark.kind === 'text') {
      w = font.widthOfTextAtSize(mark.text, mark.fontSize);
      h = font.heightAtSize(mark.fontSize, { descender: false });
    } else {
      const s = image!.scale(1);
      w = Math.max(1, pw * Math.min(1, Math.max(0.01, (mark as ImageWatermark).scale)));
      h = (w * s.height) / s.width;
    }

    const centers: Array<{ cx: number; cy: number }> = [];
    if (args.tile) {
      centers.push(...tileCenters(pw, ph, w, h, args.angle));
    } else {
      const bounds = rotatedBounds(w, h, args.angle);
      centers.push(anchorCenter(args.position, bounds.width, bounds.height, pw, ph, args.margin));
    }

    isolateExistingContent(doc, page);
    const rotateUser = degrees(args.angle + normalizeRotation(r));
    for (const { cx, cy } of centers) {
      const ov = originForCenteredRotation(cx, cy, w, h, args.angle);
      const o = visualToUser(ov.x, ov.y, box, r);
      if (font && mark.kind === 'text') {
        page.drawText(mark.text, {
          x: o.x,
          y: o.y,
          size: mark.fontSize,
          font,
          color: rgb(...mark.color),
          opacity: args.opacity,
          rotate: rotateUser,
        });
      } else if (image) {
        page.drawImage(image, { x: o.x, y: o.y, width: w, height: h, opacity: args.opacity, rotate: rotateUser });
      }
    }
  }
  ctx.progress(0.95, 'Saving');
  touch(doc);
  return save(doc);
}

// ---------------------------------------------------------------------------
// Metadata

export async function setMetadata(
  args: { bytes: Uint8Array; fields: MetadataFields; removeAll: boolean; removeXmp: boolean; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  if (args.removeAll) removeAllMetadata(doc);
  else writeMetadata(doc, args.fields, { removeXmp: args.removeXmp });
  // Old values also live in objects nothing refers to any more (the removed XMP packet, Info
  // dictionaries left behind by earlier incremental saves). pdf-lib writes every object it
  // parsed, so drop the unreachable ones or "removed" metadata would still be in the file.
  removeUnreachable(doc);
  ctx.progress(0.9, 'Saving');
  return save(doc);
}

// ---------------------------------------------------------------------------
// Lossless compression

export interface CompressStats {
  objectsBefore: number;
  objectsAfter: number;
  removedObjects: number;
  compressedStreams: number;
}

function refsReachable(doc: PDFDocument): Set<PDFRef> {
  const { context } = doc;
  const seen = new Set<PDFRef>();
  const stack: unknown[] = [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt];
  while (stack.length) {
    const obj = stack.pop();
    if (!obj) continue;
    if (obj instanceof PDFRef) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      stack.push(context.lookup(obj));
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }
  return seen;
}

/** Delete every indirect object that the trailer (Root, Info, Encrypt) cannot reach. Returns how many. */
export function removeUnreachable(doc: PDFDocument): number {
  const reachable = refsReachable(doc);
  let removed = 0;
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) {
      doc.context.delete(ref);
      removed++;
    }
  }
  return removed;
}

export async function compressLossless(
  args: { bytes: Uint8Array; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<{ bytes: Uint8Array; stats: CompressStats }> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  const { context } = doc;
  const encrypted = isEncryptedDoc(doc);
  const objectsBefore = context.enumerateIndirectObjects().length;
  ctx.progress(0.2, 'Finding unused objects');
  const removed = removeUnreachable(doc);
  ctx.progress(0.4, 'Compressing streams');
  let compressedStreams = 0;
  if (!encrypted) {
    const objects = context.enumerateIndirectObjects();
    for (let i = 0; i < objects.length; i++) {
      const [ref, obj] = objects[i];
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.has(PDFName.of('Filter'))) continue;
      const type = obj.dict.lookup(PDFName.of('Type'));
      if (type === PDFName.of('Metadata') || type === PDFName.of('XRef') || type === PDFName.of('ObjStm')) continue;
      const contents = obj.contents;
      if (contents.length < 128) continue;
      const deflated = zlibSync(contents, { level: 9 });
      if (deflated.length >= contents.length * 0.95) continue;
      const dict = obj.dict.clone(context);
      dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      dict.delete(PDFName.of('DecodeParms'));
      dict.set(PDFName.of('Length'), PDFNumber.of(deflated.length));
      context.assign(ref, PDFRawStream.of(dict, deflated));
      compressedStreams++;
      if (i % 200 === 0) ctx.progress(0.4 + 0.4 * (i / objects.length), 'Compressing streams');
    }
  }
  ctx.progress(0.85, 'Saving with object streams');
  const bytes = await save(doc, true);
  return {
    bytes,
    stats: {
      objectsBefore,
      objectsAfter: context.enumerateIndirectObjects().length,
      removedObjects: removed,
      compressedStreams,
    },
  };
}

// ---------------------------------------------------------------------------
// Images → PDF

export interface ImagePageInput {
  bytes: Uint8Array;
  format: 'png' | 'jpg';
  /** Pixel size of the image. */
  width: number;
  height: number;
  /** Explicit page size in points (e.g. when rebuilding rasterized pages). */
  pageWidth?: number;
  pageHeight?: number;
}

export interface ImageLayout {
  /** 'fit' makes each page the size of its image (at 96 DPI). */
  pageSize: 'fit' | 'a4' | 'letter';
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Margin around the image, in points. */
  margin: number;
}

const PAGE_POINTS = { a4: [595.28, 841.89], letter: [612, 792] } as const;

export function imagePlacement(
  img: { width: number; height: number; pageWidth?: number; pageHeight?: number },
  layout: ImageLayout,
): { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number } {
  const m = Math.max(0, layout.margin);
  if (img.pageWidth && img.pageHeight) {
    return { pageWidth: img.pageWidth, pageHeight: img.pageHeight, x: 0, y: 0, width: img.pageWidth, height: img.pageHeight };
  }
  if (layout.pageSize === 'fit') {
    const w = (img.width * 72) / 96;
    const h = (img.height * 72) / 96;
    return { pageWidth: w + 2 * m, pageHeight: h + 2 * m, x: m, y: m, width: w, height: h };
  }
  let [pw, ph]: number[] = [...PAGE_POINTS[layout.pageSize]];
  const landscape = layout.orientation === 'landscape' || (layout.orientation === 'auto' && img.width > img.height);
  if (landscape) [pw, ph] = [ph, pw];
  const availW = Math.max(1, pw - 2 * m);
  const availH = Math.max(1, ph - 2 * m);
  const s = Math.min(availW / img.width, availH / img.height);
  const width = img.width * s;
  const height = img.height * s;
  return { pageWidth: pw, pageHeight: ph, x: (pw - width) / 2, y: (ph - height) / 2, width, height };
}

export async function imagesToPdf(
  args: { images: ImagePageInput[]; layout: ImageLayout; title?: string },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  if (args.images.length === 0) throw new PdfError('invalid-input', 'Add at least one image.');
  const doc = await newDoc();
  if (args.title) doc.setTitle(args.title);
  for (let i = 0; i < args.images.length; i++) {
    ctx.checkCancelled();
    ctx.progress(i / args.images.length, `Adding image ${i + 1} of ${args.images.length}`);
    const img = args.images[i];
    let embedded;
    try {
      embedded = img.format === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    } catch {
      throw new PdfError('invalid-input', `Image ${i + 1} could not be embedded (the file may be damaged).`);
    }
    const place = imagePlacement(img, args.layout);
    const page = doc.addPage([place.pageWidth, place.pageHeight]);
    page.drawImage(embedded, { x: place.x, y: place.y, width: place.width, height: place.height });
  }
  ctx.progress(0.97, 'Saving');
  return save(doc);
}

// ---------------------------------------------------------------------------
// OCR text layer

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrPage {
  index: number;
  imageWidth: number;
  imageHeight: number;
  /** Words grouped by line so spaces can be inserted between words. */
  lines: OcrWord[][];
}

/** Add an invisible, selectable/searchable text layer to pages (keeps the original page content). */
export async function addTextLayer(
  args: { bytes: Uint8Array; pages: OcrPage[]; ignoreEncryption?: boolean },
  ctx: OpContext = noopContext,
): Promise<Uint8Array> {
  const doc = await loadDoc(args.bytes, args.ignoreEncryption);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    Array.from(s)
      .map((ch) => (charset.has(ch.codePointAt(0)!) ? ch : '?'))
      .join('');

  for (let k = 0; k < args.pages.length; k++) {
    ctx.checkCancelled();
    ctx.progress(k / args.pages.length, 'Adding text layer');
    const ocr = args.pages[k];
    const page = pages[ocr.index];
    if (!page) continue;
    const box = boxOf(page);
    const r = normalizeRotation(page.getRotation().angle);
    const { width: pw, height: ph } = visualSize(box, r);
    const sx = pw / ocr.imageWidth;
    const sy = ph / ocr.imageHeight;
    isolateExistingContent(doc, page);
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const line of ocr.lines) {
      line.forEach((word, w) => {
        const text = clean(word.text.trim());
        if (!text) return;
        const width = Math.max(0.5, (word.x1 - word.x0) * sx);
        const height = Math.max(0.5, (word.y1 - word.y0) * sy);
        const size = Math.max(1, height * 0.92);
        const shown = w < line.length - 1 ? `${text} ` : text;
        const natural = font.widthOfTextAtSize(text, size);
        const squeeze = natural > 0 ? Math.min(1000, Math.max(5, (width / natural) * 100)) : 100;
        const baselineV = ph - word.y1 * sy + height * 0.2;
        const o = visualToUser(word.x0 * sx, baselineV, box, r);
        ops.push(
          setFontAndSize(fontKey, size),
          setCharacterSqueeze(squeeze),
          rotateAndSkewTextDegreesAndTranslate(r, 0, 0, o.x, o.y),
          showText(font.encodeText(shown)),
        );
      });
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  ctx.progress(0.95, 'Saving');
  touch(doc);
  return save(doc);
}

// ---------------------------------------------------------------------------
// Structure inspection (fonts, objects, catalog)

export interface FontInfo {
  name: string;
  type: string;
  embedded: boolean;
  subset: boolean;
  pages: number[];
}

export interface StructureInfo {
  catalogVersion: string | null;
  objectCount: number;
  fonts: FontInfo[];
  hasXmp: boolean;
  hasJavaScript: boolean;
  hasAcroForm: boolean;
  formFieldCount: number;
  pageLabels: boolean;
  tagged: boolean;
  encrypted: boolean;
}

function inheritedResources(node: PDFDict): PDFDict | undefined {
  let current: PDFDict | undefined = node;
  for (let depth = 0; current && depth < 64; depth++) {
    const res = current.lookup(PDFName.of('Resources'));
    if (res instanceof PDFDict) return res;
    const parent: unknown = current.lookup(PDFName.of('Parent'));
    current = parent instanceof PDFDict ? parent : undefined;
  }
  return undefined;
}

function nameOf(value: unknown): string {
  return value instanceof PDFName ? value.decodeText() : '';
}

export async function inspectStructure(
  args: { bytes: Uint8Array },
  ctx: OpContext = noopContext,
): Promise<StructureInfo> {
  const doc = await loadDoc(args.bytes, true);
  const fonts = new Map<string, FontInfo>();
  const pages = doc.getPages();
  const visitedResources = new Set<PDFDict>();

  const scanResources = (res: PDFDict | undefined, pageNo: number, depth: number) => {
    if (!res || depth > 8) return;
    const fontDict = res.lookup(PDFName.of('Font'));
    if (fontDict instanceof PDFDict) {
      for (const [, value] of fontDict.entries()) {
        const font = value instanceof PDFRef ? doc.context.lookup(value) : value;
        if (!(font instanceof PDFDict)) continue;
        const subtype = nameOf(font.lookup(PDFName.of('Subtype')));
        const baseFont = nameOf(font.lookup(PDFName.of('BaseFont'))) || nameOf(font.lookup(PDFName.of('Name'))) || '(unnamed)';
        let descriptor = font.lookup(PDFName.of('FontDescriptor'));
        if (subtype === 'Type0') {
          const desc = font.lookup(PDFName.of('DescendantFonts'));
          const first = desc instanceof PDFArray ? desc.lookup(0) : undefined;
          if (first instanceof PDFDict) descriptor = first.lookup(PDFName.of('FontDescriptor'));
        }
        const embedded =
          subtype === 'Type3' ||
          (descriptor instanceof PDFDict &&
            ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor instanceof PDFDict && descriptor.has(PDFName.of(k))));
        const key = `${baseFont}|${subtype}|${embedded}`;
        const existing = fonts.get(key);
        if (existing) {
          if (!existing.pages.includes(pageNo)) existing.pages.push(pageNo);
        } else {
          fonts.set(key, { name: baseFont.replace(/^[A-Z]{6}\+/, ''), type: subtype || 'Unknown', embedded, subset: /^[A-Z]{6}\+/.test(baseFont), pages: [pageNo] });
        }
      }
    }
    const xobjects = res.lookup(PDFName.of('XObject'));
    if (xobjects instanceof PDFDict) {
      for (const [, value] of xobjects.entries()) {
        const xo = value instanceof PDFRef ? doc.context.lookup(value) : value;
        if (!(xo instanceof PDFStream)) continue;
        if (nameOf(xo.dict.lookup(PDFName.of('Subtype'))) !== 'Form') continue;
        const inner = xo.dict.lookup(PDFName.of('Resources'));
        if (inner instanceof PDFDict && !visitedResources.has(inner)) {
          visitedResources.add(inner);
          scanResources(inner, pageNo, depth + 1);
        }
      }
    }
  };

  pages.forEach((page, i) => {
    if (i % 25 === 0) ctx.progress(i / pages.length, 'Reading fonts');
    scanResources(inheritedResources(page.node), i + 1, 0);
  });

  const catalog = doc.catalog;
  const acro = catalog.lookup(PDFName.of('AcroForm'));
  let formFieldCount = 0;
  if (acro instanceof PDFDict) {
    const fields = acro.lookup(PDFName.of('Fields'));
    if (fields instanceof PDFArray) formFieldCount = fields.size();
  }
  const names = catalog.lookup(PDFName.of('Names'));
  const markInfo = catalog.lookup(PDFName.of('MarkInfo'));
  const marked = markInfo instanceof PDFDict ? markInfo.lookup(PDFName.of('Marked')) : undefined;
  return {
    catalogVersion: nameOf(catalog.lookup(PDFName.of('Version'))) || null,
    objectCount: doc.context.enumerateIndirectObjects().length,
    fonts: [...fonts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    hasXmp: catalog.has(PDFName.of('Metadata')),
    hasJavaScript:
      (names instanceof PDFDict && names.has(PDFName.of('JavaScript'))) || catalog.has(PDFName.of('OpenAction')) && /JavaScript/.test(String(catalog.lookup(PDFName.of('OpenAction')))),
    hasAcroForm: acro instanceof PDFDict,
    formFieldCount,
    pageLabels: catalog.has(PDFName.of('PageLabels')),
    tagged: Boolean(marked && String(marked) === 'true'),
    encrypted: Boolean(doc.context.trailerInfo.Encrypt),
  };
}

// ---------------------------------------------------------------------------

export const OPS = {
  merge,
  split,
  selectPages,
  organize,
  rotate,
  crop,
  addPageNumbers,
  addWatermark,
  setMetadata,
  compressLossless,
  imagesToPdf,
  addTextLayer,
  inspectStructure,
} as const;

export type OpName = keyof typeof OPS;
export type OpArgs<K extends OpName> = Parameters<(typeof OPS)[K]>[0];
export type OpResult<K extends OpName> = Awaited<ReturnType<(typeof OPS)[K]>>;
