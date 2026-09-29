/**
 * Conservative string-format detection used when inferring types and schemas.
 * Every pattern is a strict subset of what JSON Schema validators accept for the
 * format, so a generated `"format"` never rejects the sample it came from.
 */

export type StringFormat = 'date-time' | 'date' | 'time' | 'email' | 'uri' | 'uuid';

export const FORMAT_BITS: Record<StringFormat, number> = {
  'date-time': 1,
  date: 2,
  time: 4,
  email: 8,
  uri: 16,
  uuid: 32,
};

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL =
  /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+-]{1,64}(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const URI_CHAR = "[A-Za-z0-9\\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2}";
const URI = new RegExp(
  '^(?:https?|ftp|wss?)://' +
    '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*' +
    '(?::\\d{1,5})?' +
    `(?:/(?:${URI_CHAR})*)*` +
    `(?:\\?(?:${URI_CHAR}|[/?])*)?` +
    `(?:#(?:${URI_CHAR}|[/?])*)?$`,
);

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d <= (m === 2 && leap ? 29 : DAYS[m - 1]);
}

function validTime(h: number, min: number, s: number, oh?: string, om?: string): boolean {
  if (h > 23 || min > 59 || s > 59) return false;
  if (oh !== undefined && (Number(oh) > 23 || Number(om) > 59)) return false;
  return true;
}

/** Bit mask of the formats a string satisfies (see FORMAT_BITS). */
export function detectFormats(s: string): number {
  const len = s.length;
  if (len < 6 || len > 2048) return 0;
  const first = s.charCodeAt(0);
  if (first >= 48 && first <= 57 && len <= 40) {
    let m = DATE_TIME.exec(s);
    if (m) {
      return validDate(+m[1], +m[2], +m[3]) && validTime(+m[4], +m[5], +m[6], m[7], m[8]) ? FORMAT_BITS['date-time'] : 0;
    }
    m = DATE.exec(s);
    if (m) return validDate(+m[1], +m[2], +m[3]) ? FORMAT_BITS.date : 0;
    m = TIME.exec(s);
    if (m) return validTime(+m[1], +m[2], +m[3], m[4], m[5]) ? FORMAT_BITS.time : 0;
  }
  if (len === 36 && UUID.test(s)) return FORMAT_BITS.uuid;
  if (len <= 254 && s.includes('@') && EMAIL.test(s)) return FORMAT_BITS.email;
  if (s.includes('://') && URI.test(s)) return FORMAT_BITS.uri;
  return 0;
}

/** The single format encoded in a mask, if exactly one bit is set. */
export function formatFromMask(mask: number): StringFormat | undefined {
  for (const [name, bit] of Object.entries(FORMAT_BITS) as Array<[StringFormat, number]>) {
    if (mask === bit) return name;
  }
  return undefined;
}
