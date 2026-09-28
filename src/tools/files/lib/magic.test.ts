import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, gzipSync } from 'fflate';
import { asciiPreview, detectFileType, extensionMatches, extensionOf, hexPreview, matchAt, SIGNATURE_COUNT, TYPES } from './magic';

const b = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
const pad = (n: number) => new Array(n).fill(0);
const id = (head: Uint8Array, tail?: Uint8Array) => detectFileType({ head, tail }).id;

describe('detectFileType: images', () => {
  it('detects common image formats', () => {
    expect(id(b([0x89], 'PNG\r\n', [0x1a, 0x0a], pad(20)))).toBe('png');
    expect(id(b([0x89], 'PNG\r\n', [0x1a, 0x0a], pad(20), 'acTL'))).toBe('apng');
    expect(id(b([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(id(b('GIF89a', pad(10)))).toBe('gif');
    expect(id(b('BM', pad(12), [40], pad(20)))).toBe('bmp');
    expect(id(b([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]))).toBe('ico');
    expect(id(b([0x49, 0x49, 0x2a, 0]))).toBe('tiff');
    expect(id(b('8BPS'))).toBe('psd');
  });

  it('distinguishes RIFF subtypes', () => {
    expect(id(b('RIFF', pad(4), 'WEBPVP8 '))).toBe('webp');
    expect(id(b('RIFF', pad(4), 'WAVEfmt '))).toBe('wav');
    expect(id(b('RIFF', pad(4), 'AVI LIST'))).toBe('avi');
    expect(detectFileType({ head: b('RIFF', pad(4), 'XYZW') }).name).toContain('XYZW');
  });

  it('distinguishes ftyp brands: mp4, mov, m4a, heic, avif, 3gp', () => {
    const ftyp = (major: string, compat: string[] = []) => {
      const body = b('ftyp', major, pad(4), ...compat);
      return b([0, 0, 0, body.length + 4], Array.from(body));
    };
    expect(id(ftyp('isom', ['iso2', 'mp41']))).toBe('mp4');
    expect(id(ftyp('qt  '))).toBe('mov');
    expect(id(ftyp('M4A ', ['isom']))).toBe('m4a');
    expect(id(ftyp('heic', ['mif1']))).toBe('heic');
    expect(id(ftyp('mif1', ['avif']))).toBe('avif');
    expect(id(ftyp('3gp4'))).toBe('3gp');
  });
});

describe('detectFileType: zip containers', () => {
  it('plain zip', () => {
    expect(id(zipSync({ 'a.txt': strToU8('hello') }))).toBe('zip');
  });
  it('docx, xlsx, pptx', () => {
    expect(
      id(
        zipSync({
          '[Content_Types].xml': strToU8('<Types/>'),
          'word/document.xml': strToU8('<w/>'),
        }),
      ),
    ).toBe('docx');
    expect(
      id(
        zipSync({
          '[Content_Types].xml': strToU8('<Types/>'),
          'xl/workbook.xml': strToU8('<x/>'),
        }),
      ),
    ).toBe('xlsx');
    expect(
      id(
        zipSync({
          '[Content_Types].xml': strToU8('<Types/>'),
          'ppt/presentation.xml': strToU8('<p/>'),
        }),
      ),
    ).toBe('pptx');
  });
  it('epub and OpenDocument via the mimetype entry', () => {
    expect(
      id(
        zipSync({
          mimetype: [strToU8('application/epub+zip'), { level: 0 }],
          'OEBPS/a.html': strToU8('x'),
        }),
      ),
    ).toBe('epub');
    expect(
      id(
        zipSync({
          mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
        }),
      ),
    ).toBe('odt');
    expect(
      id(
        zipSync({
          mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
        }),
      ),
    ).toBe('ods');
  });
  it('jar and apk', () => {
    expect(id(zipSync({ 'META-INF/MANIFEST.MF': strToU8('Manifest-Version: 1.0') }))).toBe('jar');
    expect(
      id(
        zipSync({
          'AndroidManifest.xml': strToU8('x'),
          'classes.dex': strToU8('dex\n'),
        }),
      ),
    ).toBe('apk');
  });
});

describe('detectFileType: archives, media, fonts, executables, data', () => {
  it('archives', () => {
    expect(id(gzipSync(strToU8('hello')))).toBe('gzip');
    expect(id(b('BZh9'))).toBe('bzip2');
    expect(id(b([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))).toBe('xz');
    expect(id(b([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
    expect(id(b('Rar!', [0x1a, 0x07, 0x00]))).toBe('rar4');
    expect(id(b('Rar!', [0x1a, 0x07, 0x01, 0x00]))).toBe('rar5');
    expect(id(b([0x28, 0xb5, 0x2f, 0xfd]))).toBe('zstd');
    expect(id(b('MSCF'))).toBe('cab');
    expect(id(b('!<arch>\ndebian-binary'))).toBe('deb');
    expect(id(b('file.txt', pad(249), 'ustar', pad(10)))).toBe('tar');
    const iso = new Uint8Array(0x8010);
    iso.set(b('CD001'), 0x8001);
    expect(id(iso)).toBe('iso');
    const tail = new Uint8Array(512);
    tail.set(b('koly'), 0);
    expect(id(b([0x78, 0x01, 0x73, 0x0d]), tail)).toBe('dmg');
  });
  it('audio and video', () => {
    expect(id(b('ID3', [4, 0]))).toBe('mp3');
    expect(id(b([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3');
    expect(id(b('fLaC'))).toBe('flac');
    expect(id(b('OggS', pad(24), 'OpusHead'))).toBe('opus');
    expect(id(b('OggS', pad(24), [1], 'vorbis'))).toBe('ogg');
    expect(id(b('MThd'))).toBe('midi');
    expect(id(b([0x1a, 0x45, 0xdf, 0xa3], pad(20), 'webm'))).toBe('webm');
    expect(id(b([0x1a, 0x45, 0xdf, 0xa3], pad(20), 'matroska'))).toBe('mkv');
    expect(id(b('FLV', [1]))).toBe('flv');
  });
  it('fonts', () => {
    expect(id(b('wOFF'))).toBe('woff');
    expect(id(b('wOF2'))).toBe('woff2');
    expect(id(b('OTTO'))).toBe('otf');
    expect(id(b([0, 1, 0, 0], pad(12), 'cmap', pad(12), 'glyf'))).toBe('ttf');
  });
  it('executables', () => {
    const pe = new Uint8Array(0x100);
    pe.set(b('MZ'), 0);
    pe[60] = 0x80;
    pe.set(b('PE\0\0'), 0x80);
    expect(id(pe)).toBe('exe');
    expect(id(b('MZ', pad(100)))).toBe('msdos');
    expect(id(b([0x7f], 'ELF'))).toBe('elf');
    expect(id(b([0xcf, 0xfa, 0xed, 0xfe]))).toBe('macho');
    expect(id(b([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52]))).toBe('class');
    expect(id(b([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]))).toBe('macho');
    expect(id(b([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))).toBe('wasm');
    expect(id(b('dex\n035'))).toBe('dex');
  });
  it('data files', () => {
    expect(id(b('SQLite format 3\0'))).toBe('sqlite');
    expect(id(b([0xd4, 0xc3, 0xb2, 0xa1]))).toBe('pcap');
    expect(id(b('%PDF-1.7'))).toBe('pdf');
    expect(id(b([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe('ole');
    expect(id(b('{\\rtf1'))).toBe('rtf');
  });
});

describe('detectFileType: text', () => {
  const t = (s: string) => id(new TextEncoder().encode(s));
  it('recognizes structured text', () => {
    expect(t('{"a": [1, 2, 3]}')).toBe('json');
    expect(t('<?xml version="1.0"?><root/>')).toBe('xml');
    expect(t('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe('svg');
    expect(t('<!DOCTYPE html><html></html>')).toBe('html');
    expect(t('-----BEGIN CERTIFICATE-----\nMIIB\n')).toBe('pem');
    expect(t('#!/usr/bin/env python3\nprint(1)')).toBe('script');
    expect(t('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe('ics');
    expect(t('BEGIN:VCARD\r\nEND:VCARD')).toBe('vcf');
  });
  it('plain text including Unicode/emoji, and binary rejection', () => {
    expect(t('hello, world 😀 — ünïcödé\n')).toBe('text');
    expect(t('{not json')).toBe('text');
    expect(id(b([0xef, 0xbb, 0xbf], 'hi'))).toBe('utf8bom');
    expect(id(b([0xff, 0xfe, 0x68, 0x00]))).toBe('utf16');
    expect(id(new Uint8Array([1, 2, 3, 0, 5, 200, 7]))).toBe('binary');
    expect(detectFileType({ head: new Uint8Array(0), size: 0 }).id).toBe('empty');
  });
  it('large random data is binary', () => {
    const big = new Uint8Array(65536);
    let x = 1;
    for (let i = 0; i < big.length; i++) big[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    expect(id(big)).toBe('binary');
  });
});

describe('helpers', () => {
  it('has a large signature database', () => {
    expect(SIGNATURE_COUNT).toBeGreaterThanOrEqual(60);
  });
  it('matchAt supports wildcards', () => {
    expect(matchAt(b('ABCD'), 1, [0x42, null, 0x44])).toBe(true);
    expect(matchAt(b('AB'), 1, [0x42, null])).toBe(false);
  });
  it('extension checks', () => {
    expect(extensionOf('Report.Final.PDF')).toBe('pdf');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('folder/noext')).toBe('');
    expect(extensionMatches(TYPES.pdf, 'a.pdf')).toBe(true);
    expect(extensionMatches(TYPES.zip, 'report.pdf')).toBe(false);
    expect(extensionMatches(TYPES.jpeg, 'photo.JPEG')).toBe(true);
    expect(extensionMatches(TYPES.text, 'notes.whatever')).toBe(true);
    expect(extensionMatches(TYPES.zip, 'comic.cbz')).toBe(true);
  });
  it('previews', () => {
    expect(hexPreview(b('AB'), 4)).toBe('41 42');
    expect(asciiPreview(b('A', [0, 200], 'z'))).toBe('A..z');
  });
});

describe('detectFileType: robustness', () => {
  const t = (s: string) => id(new TextEncoder().encode(s));
  it('does not mistake text that starts like a binary magic for a binary format', () => {
    expect(t('true, false, maybe')).toBe('text');
    expect(t('BM is a nice abbreviation')).toBe('text');
  });
  it('treats legacy 8-bit text (Windows-1252) as text', () => {
    expect(id(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x63, 0x72, 0xe8, 0x6d, 0x65, 0x0a]))).toBe('text');
  });
  it('tolerates a multi-byte UTF-8 character cut at the end of a truncated head', () => {
    const bytes = new TextEncoder().encode('{"k": "😀"}');
    expect(detectFileType({ head: bytes.subarray(0, 8), size: 1000 }).id).toBe('json');
  });
  it('detects AAC/ADTS, SVG without prolog, and HTML fragments', () => {
    expect(id(b([0xff, 0xf1, 0x50, 0x80]))).toBe('aac');
    expect(t('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('svg');
    expect(t('<html lang="en"><body></body></html>')).toBe('html');
  });
  it('flags text content hiding behind a binary extension', () => {
    expect(extensionMatches(TYPES.text, 'photo.png')).toBe(false);
    expect(extensionMatches(TYPES.json, 'data.txt')).toBe(true);
    expect(extensionMatches(TYPES.elf, 'mytool')).toBe(true);
    expect(extensionMatches(TYPES.binary, 'anything.png')).toBe(true);
  });
});
