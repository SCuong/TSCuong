/**
 * Builders and parsers for structured QR payloads: Wi-Fi, vCard 3.0,
 * mailto, tel, SMS, geo and iCalendar events. Pure functions.
 */

// ---------------------------------------------------------------------------
// Wi-Fi (the de-facto "WIFI:" format from ZXing)
// ---------------------------------------------------------------------------

export type WifiSecurity = 'WPA' | 'WEP' | 'SAE' | 'nopass';

export interface WifiConfig {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

/** Backslash-escape the characters that are special in WIFI: strings. */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

export function unescapeWifi(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

export function validateWifi(c: WifiConfig): string | null {
  if (!c.ssid) return 'Enter the network name (SSID).';
  if (new TextEncoder().encode(c.ssid).length > 32) return 'The network name is longer than 32 bytes, which Wi-Fi does not allow.';
  if (c.security === 'nopass') return null;
  if (!c.password) return 'Enter the password, or choose "No password".';
  if (c.security === 'WPA' || c.security === 'SAE') {
    const hex64 = /^[0-9a-f]{64}$/i.test(c.password);
    if (!hex64 && (c.password.length < 8 || c.password.length > 63)) return 'WPA passwords must be 8–63 characters (or 64 hex digits).';
  }
  if (c.security === 'WEP' && ![5, 13, 16, 29].includes(c.password.length) && !/^([0-9a-f]{10}|[0-9a-f]{26}|[0-9a-f]{32}|[0-9a-f]{58})$/i.test(c.password)) {
    return 'WEP keys are 5, 13, 16 or 29 characters (or 10/26/32/58 hex digits).';
  }
  return null;
}

export function buildWifi(c: WifiConfig): string {
  const parts = [`T:${c.security === 'nopass' ? 'nopass' : c.security}`, `S:${escapeWifi(c.ssid)}`];
  if (c.security !== 'nopass') parts.push(`P:${escapeWifi(c.password)}`);
  if (c.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

/** Split on unescaped `sep`. */
function splitUnescaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i++;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseWifi(text: string): WifiConfig | null {
  if (!/^WIFI:/i.test(text.trim())) return null;
  const body = text.trim().slice(5);
  const fields: Record<string, string> = {};
  for (const part of splitUnescaped(body, ';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).toUpperCase();
    if (!(key in fields)) fields[key] = unescapeWifi(part.slice(idx + 1));
  }
  if (fields.S === undefined) return null;
  const t = (fields.T ?? '').toUpperCase();
  const security: WifiSecurity = t === 'WEP' ? 'WEP' : t === 'SAE' || t === 'WPA3' ? 'SAE' : t === '' || t === 'NOPASS' ? (fields.P ? 'WPA' : 'nopass') : 'WPA';
  return { ssid: fields.S, password: fields.P ?? '', security, hidden: /^true$/i.test(fields.H ?? '') };
}

// ---------------------------------------------------------------------------
// vCard 3.0
// ---------------------------------------------------------------------------

export interface VCard {
  firstName: string;
  lastName: string;
  organization: string;
  title: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  street: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  note: string;
}

export const EMPTY_VCARD: VCard = {
  firstName: '',
  lastName: '',
  organization: '',
  title: '',
  phone: '',
  mobile: '',
  email: '',
  website: '',
  street: '',
  city: '',
  region: '',
  postcode: '',
  country: '',
  note: '',
};

/** Escape a vCard/iCalendar text value (RFC 2426 / RFC 5545). */
export function escapeText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function unescapeText(v: string): string {
  return v.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function buildVCard(c: VCard): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const fn = [c.firstName, c.lastName].map((s) => s.trim()).filter(Boolean).join(' ') || c.organization.trim();
  lines.push(`N:${escapeText(c.lastName.trim())};${escapeText(c.firstName.trim())};;;`);
  lines.push(`FN:${escapeText(fn)}`);
  if (c.organization.trim()) lines.push(`ORG:${escapeText(c.organization.trim())}`);
  if (c.title.trim()) lines.push(`TITLE:${escapeText(c.title.trim())}`);
  if (c.mobile.trim()) lines.push(`TEL;TYPE=CELL:${c.mobile.trim()}`);
  if (c.phone.trim()) lines.push(`TEL;TYPE=WORK,VOICE:${c.phone.trim()}`);
  if (c.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${c.email.trim()}`);
  if (c.website.trim()) lines.push(`URL:${c.website.trim()}`);
  if ([c.street, c.city, c.region, c.postcode, c.country].some((s) => s.trim())) {
    lines.push(`ADR;TYPE=WORK:;;${[c.street, c.city, c.region, c.postcode, c.country].map((s) => escapeText(s.trim())).join(';')}`);
  }
  if (c.note.trim()) lines.push(`NOTE:${escapeText(c.note.trim())}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function validateVCard(c: VCard): string | null {
  if (![c.firstName, c.lastName, c.organization].some((s) => s.trim())) return 'Enter a name or an organization.';
  if (c.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return 'The email address looks invalid.';
  return null;
}

export interface ParsedVCard {
  name: string;
  firstName: string;
  lastName: string;
  organization: string;
  title: string;
  phones: string[];
  emails: string[];
  urls: string[];
  addresses: string[];
  note: string;
}

/** Split a structured value on unescaped `;`. */
function splitStructured(v: string): string[] {
  return splitUnescaped(v, ';').map(unescapeText);
}

export function parseVCard(text: string): ParsedVCard | null {
  if (!/BEGIN:VCARD/i.test(text)) return null;
  // Unfold continuation lines (a CRLF followed by a space or tab).
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out: ParsedVCard = { name: '', firstName: '', lastName: '', organization: '', title: '', phones: [], emails: [], urls: [], addresses: [], note: '' };
  for (const raw of unfolded.split(/\r?\n/)) {
    const line = raw.trim();
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const prop = line.slice(0, idx).split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
    const value = line.slice(idx + 1);
    switch (prop) {
      case 'FN':
        out.name = unescapeText(value);
        break;
      case 'N': {
        const [last = '', first = ''] = splitStructured(value);
        out.lastName = last;
        out.firstName = first;
        break;
      }
      case 'ORG':
        out.organization = splitStructured(value).filter(Boolean).join(', ');
        break;
      case 'TITLE':
        out.title = unescapeText(value);
        break;
      case 'TEL':
        out.phones.push(value.replace(/^tel:/i, ''));
        break;
      case 'EMAIL':
        out.emails.push(value);
        break;
      case 'URL':
        out.urls.push(unescapeText(value));
        break;
      case 'ADR':
        out.addresses.push(splitStructured(value).filter(Boolean).join(', '));
        break;
      case 'NOTE':
        out.note = unescapeText(value);
        break;
    }
  }
  if (!out.name) out.name = [out.firstName, out.lastName].filter(Boolean).join(' ');
  return out;
}

// ---------------------------------------------------------------------------
// Email, phone, SMS, geo
// ---------------------------------------------------------------------------

export function buildMailto(to: string, subject: string, body: string): string {
  const params = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}` : '',
  ].filter(Boolean);
  return `mailto:${to.trim()}${params.length ? `?${params.join('&')}` : ''}`;
}

export function normalizePhone(p: string): string {
  return p.trim().replace(/[^\d+*#]/g, '');
}

export function validatePhone(p: string): string | null {
  const n = normalizePhone(p);
  if (!n) return 'Enter a phone number.';
  if (!/^\+?[\d*#]{3,20}$/.test(n)) return 'The phone number should contain 3–20 digits (an optional leading +).';
  return null;
}

export function buildTel(p: string): string {
  return `tel:${normalizePhone(p)}`;
}

export function buildSms(p: string, message: string): string {
  return `SMSTO:${normalizePhone(p)}:${message}`;
}

export function validateGeo(lat: number | '', lng: number | ''): string | null {
  if (lat === '' || lng === '') return 'Enter a latitude and a longitude.';
  if (lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.';
  if (lng < -180 || lng > 180) return 'Longitude must be between -180 and 180.';
  return null;
}

export function buildGeo(lat: number, lng: number, label = ''): string {
  const r = (n: number) => String(Math.round(n * 1e6) / 1e6);
  return `geo:${r(lat)},${r(lng)}${label.trim() ? `?q=${encodeURIComponent(`${r(lat)},${r(lng)}(${label.trim()})`)}` : ''}`;
}

// ---------------------------------------------------------------------------
// Calendar event (iCalendar)
// ---------------------------------------------------------------------------

export interface EventConfig {
  title: string;
  location: string;
  description: string;
  allDay: boolean;
  /** Local date-time strings from <input type="datetime-local"> or dates (YYYY-MM-DD) when all-day. */
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toIcsUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function icsDate(s: string): string {
  return s.slice(0, 10).replace(/-/g, '');
}

function nextDay(s: string): string {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

export function validateEvent(e: EventConfig): string | null {
  if (!e.title.trim()) return 'Enter an event title.';
  if (!e.start) return 'Choose a start date.';
  if (e.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(e.start)) return 'The start date is invalid.';
    if (e.end && e.end.slice(0, 10) < e.start.slice(0, 10)) return 'The end date is before the start date.';
    return null;
  }
  const s = new Date(e.start);
  if (Number.isNaN(s.getTime())) return 'The start time is invalid.';
  if (e.end) {
    const en = new Date(e.end);
    if (Number.isNaN(en.getTime())) return 'The end time is invalid.';
    if (en < s) return 'The event ends before it starts.';
  }
  return null;
}

export function buildEvent(e: EventConfig, now = new Date(), uid = `${toIcsUtc(now)}-${Math.random().toString(36).slice(2, 10)}@localkit`): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LocalKit//QR Generator//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${toIcsUtc(now)}`];
  lines.push(`SUMMARY:${escapeText(e.title.trim())}`);
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(e.end || e.start)}`);
  } else {
    const start = new Date(e.start);
    const end = e.end ? new Date(e.end) : new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${toIcsUtc(start)}`, `DTEND:${toIcsUtc(end)}`);
  }
  if (e.location.trim()) lines.push(`LOCATION:${escapeText(e.location.trim())}`);
  if (e.description.trim()) lines.push(`DESCRIPTION:${escapeText(e.description.trim())}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Detection of scanned content
// ---------------------------------------------------------------------------

export type ContentKind = 'url' | 'wifi' | 'vcard' | 'email' | 'tel' | 'sms' | 'geo' | 'event' | 'text';

export interface DetectedContent {
  kind: ContentKind;
  label: string;
  fields: Array<{ label: string; value: string; secret?: boolean }>;
  /** Safe http(s)/mailto/tel link the user may open explicitly. */
  href?: string;
}

const DATE_FMT: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const DATE_TIME_FMT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/**
 * An iCalendar DTSTART/DTEND value as readable local text: UTC times ("…Z") are
 * converted to this device's time zone, floating and TZID times keep their wall
 * clock, and all-day ends (exclusive in iCalendar) show the last day of the event.
 */
export function formatIcsDate(params: string, value: string, isEnd = false): string {
  const v = value.trim();
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (day) {
    const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) - (isEnd ? 1 : 0));
    return Number.isNaN(d.getTime()) ? v : `${d.toLocaleDateString(undefined, DATE_FMT)} (all day)`;
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(v);
  if (!t) return v;
  const [y, mo, d, h, mi, s] = t.slice(1, 7).map(Number);
  if (t[7]) return new Date(Date.UTC(y, mo - 1, d, h, mi, s)).toLocaleString(undefined, DATE_TIME_FMT);
  const local = new Date(y, mo - 1, d, h, mi, s).toLocaleString(undefined, DATE_TIME_FMT);
  const tzid = /TZID=("?)([^";:]+)\1/i.exec(params)?.[2];
  return tzid ? `${local} (${tzid})` : local;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export function detectContent(raw: string): DetectedContent {
  const text = raw.trim();
  const wifi = parseWifi(text);
  if (wifi) {
    return {
      kind: 'wifi',
      label: 'Wi-Fi network',
      fields: [
        { label: 'Network (SSID)', value: wifi.ssid },
        { label: 'Security', value: wifi.security === 'nopass' ? 'None (open)' : wifi.security === 'SAE' ? 'WPA3' : wifi.security },
        ...(wifi.password ? [{ label: 'Password', value: wifi.password, secret: true }] : []),
        { label: 'Hidden', value: wifi.hidden ? 'Yes' : 'No' },
      ],
    };
  }
  const vcard = parseVCard(text);
  if (vcard) {
    const f: DetectedContent['fields'] = [];
    if (vcard.name) f.push({ label: 'Name', value: vcard.name });
    if (vcard.organization) f.push({ label: 'Organization', value: vcard.organization });
    if (vcard.title) f.push({ label: 'Title', value: vcard.title });
    vcard.phones.forEach((p) => f.push({ label: 'Phone', value: p }));
    vcard.emails.forEach((e) => f.push({ label: 'Email', value: e }));
    vcard.urls.forEach((u) => f.push({ label: 'Website', value: u }));
    vcard.addresses.forEach((a) => f.push({ label: 'Address', value: a }));
    if (vcard.note) f.push({ label: 'Note', value: vcard.note });
    return { kind: 'vcard', label: 'Contact card (vCard)', fields: f };
  }
  if (/BEGIN:VEVENT/i.test(text)) {
    const unfolded = text.replace(/\r?\n[ \t]/g, '');
    const prop = (k: string) => new RegExp(`^${k}((?:;[^:\\r\\n]*)?):(.*)$`, 'im').exec(unfolded);
    const get = (k: string) => {
      const m = prop(k);
      return m ? unescapeText(m[2].trim()) : '';
    };
    const when = (k: string, isEnd: boolean) => {
      const m = prop(k);
      return m ? formatIcsDate(m[1], m[2], isEnd) : '';
    };
    return {
      kind: 'event',
      label: 'Calendar event',
      fields: [
        { label: 'Title', value: get('SUMMARY') },
        { label: 'Starts', value: when('DTSTART', false) },
        { label: 'Ends', value: when('DTEND', true) },
        { label: 'Location', value: get('LOCATION') },
        { label: 'Description', value: get('DESCRIPTION') },
      ].filter((x) => x.value),
    };
  }
  if (/^mailto:/i.test(text)) {
    const [addr, query = ''] = text.slice(7).split('?');
    const params = new URLSearchParams(query);
    return {
      kind: 'email',
      label: 'Email',
      href: text,
      fields: [
        { label: 'To', value: safeDecode(addr) },
        ...(params.get('subject') ? [{ label: 'Subject', value: params.get('subject')! }] : []),
        ...(params.get('body') ? [{ label: 'Body', value: params.get('body')! }] : []),
      ],
    };
  }
  const matmsg = /^MATMSG:TO:([^;]*);SUB:([^;]*);BODY:([^;]*);/i.exec(text);
  if (matmsg) {
    return { kind: 'email', label: 'Email', fields: [{ label: 'To', value: matmsg[1] }, { label: 'Subject', value: matmsg[2] }, { label: 'Body', value: matmsg[3] }] };
  }
  if (/^tel:/i.test(text)) return { kind: 'tel', label: 'Phone number', href: text, fields: [{ label: 'Number', value: text.slice(4) }] };
  const smsto = /^SMSTO:([^:]*):?([\s\S]*)$/i.exec(text);
  if (smsto) return { kind: 'sms', label: 'Text message', fields: [{ label: 'To', value: smsto[1] }, ...(smsto[2] ? [{ label: 'Message', value: smsto[2] }] : [])] };
  const sms = /^sms:([^?]*)(?:\?body=(.*))?$/i.exec(text);
  if (sms) return { kind: 'sms', label: 'Text message', fields: [{ label: 'To', value: sms[1] }, ...(sms[2] ? [{ label: 'Message', value: safeDecode(sms[2]) }] : [])] };
  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text);
  if (geo) {
    return {
      kind: 'geo',
      label: 'Location',
      fields: [
        { label: 'Latitude', value: geo[1] },
        { label: 'Longitude', value: geo[2] },
      ],
      href: `https://www.openstreetmap.org/?mlat=${geo[1]}&mlon=${geo[2]}#map=16/${geo[1]}/${geo[2]}`,
    };
  }
  if (/^https?:\/\/[^\s]+$/i.test(text)) {
    try {
      const u = new URL(text);
      return { kind: 'url', label: 'Web link', href: u.href, fields: [{ label: 'Domain', value: u.hostname }, { label: 'URL', value: u.href }] };
    } catch {
      // fall through to text
    }
  }
  if (/^www\.[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) {
    return { kind: 'url', label: 'Web link', href: `https://${text}`, fields: [{ label: 'URL', value: text }] };
  }
  return { kind: 'text', label: 'Text', fields: [] };
}

// ---------------------------------------------------------------------------
// Color contrast (for QR readability)
// ---------------------------------------------------------------------------

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** A warning when colors are likely to hurt scanning, else null. */
export function qrColorWarning(fg: string, bg: string): string | null {
  const ratio = contrastRatio(fg, bg);
  if (ratio === null) return null;
  const lf = luminance(fg)!;
  const lb = luminance(bg)!;
  if (lf > lb) return 'The code color is lighter than the background. Many scanners cannot read inverted codes.';
  if (ratio < 4) return `Low contrast (${ratio.toFixed(1)}:1). Use a darker code color or lighter background (aim for at least 4:1) so phones can scan it.`;
  return null;
}
