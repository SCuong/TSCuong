/** Barcode input validation and check digits (GS1 mod-10 and friends). Pure. */

export type BarcodeFormat =
  | 'CODE128'
  | 'CODE128A'
  | 'CODE128B'
  | 'CODE128C'
  | 'EAN13'
  | 'EAN8'
  | 'UPC'
  | 'UPCE'
  | 'CODE39'
  | 'ITF14'
  | 'ITF'
  | 'MSI'
  | 'MSI10'
  | 'MSI11'
  | 'MSI1010'
  | 'MSI1110'
  | 'pharmacode'
  | 'codabar';

export const BARCODE_FORMATS: Array<{ value: BarcodeFormat; label: string; example: string; hint: string }> = [
  { value: 'CODE128', label: 'Code 128 (auto)', example: 'LocalKit-2024', hint: 'Any ASCII text. The most flexible 1D barcode.' },
  { value: 'CODE128A', label: 'Code 128 A', example: 'ABC-123', hint: 'Uppercase letters, digits, punctuation and control characters.' },
  { value: 'CODE128B', label: 'Code 128 B', example: 'Hello 123', hint: 'Upper and lowercase letters, digits and punctuation.' },
  { value: 'CODE128C', label: 'Code 128 C', example: '12345678', hint: 'Digits only, an even number of them (very compact).' },
  { value: 'EAN13', label: 'EAN-13', example: '5901234123457', hint: '12 digits (check digit added) or 13 digits.' },
  { value: 'EAN8', label: 'EAN-8', example: '96385074', hint: '7 digits (check digit added) or 8 digits.' },
  { value: 'UPC', label: 'UPC-A', example: '036000291452', hint: '11 digits (check digit added) or 12 digits.' },
  { value: 'UPCE', label: 'UPC-E', example: '01234565', hint: '6 digits, or 8 digits with number system 0/1 and check digit.' },
  { value: 'CODE39', label: 'Code 39', example: 'CODE-39', hint: 'A–Z, 0–9, space and - . $ / + %.' },
  { value: 'ITF14', label: 'ITF-14', example: '15400141288763', hint: '13 digits (check digit added) or 14 digits.' },
  { value: 'ITF', label: 'ITF (Interleaved 2 of 5)', example: '123456', hint: 'Digits only, an even number of them.' },
  { value: 'MSI', label: 'MSI', example: '1234', hint: 'Digits only (no check digit).' },
  { value: 'MSI10', label: 'MSI mod 10', example: '1234', hint: 'Digits; a mod-10 check digit is added.' },
  { value: 'MSI11', label: 'MSI mod 11', example: '1234', hint: 'Digits; a mod-11 check digit is added.' },
  { value: 'MSI1010', label: 'MSI mod 1010', example: '1234', hint: 'Digits; two mod-10 check digits are added.' },
  { value: 'MSI1110', label: 'MSI mod 1110', example: '1234', hint: 'Digits; mod-11 then mod-10 check digits are added.' },
  { value: 'pharmacode', label: 'Pharmacode', example: '1234', hint: 'A whole number from 3 to 131070.' },
  { value: 'codabar', label: 'Codabar', example: 'A123456A', hint: 'Digits and - $ : / . + with optional A–D start/stop letters.' },
];

/** GS1 mod-10 check digit for the given digits (without the check digit). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(digits.length - 1 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** Expand an 8-digit UPC-E (NS + 6 + check) to its 12-digit UPC-A. */
export function upcEToUpcA(upce: string): string {
  const ns = upce[0];
  const d = upce.slice(1, 7);
  const check = upce[7] ?? '';
  const [d1, d2, d3, d4, d5, d6] = d;
  let body: string;
  switch (d6) {
    case '0':
    case '1':
    case '2':
      body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
      break;
    case '3':
      body = `${d1}${d2}${d3}00000${d4}${d5}`;
      break;
    case '4':
      body = `${d1}${d2}${d3}${d4}00000${d5}`;
      break;
    default:
      body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
  return `${ns}${body}${check}`;
}

export interface Validation {
  ok: boolean;
  error?: string;
  /** The value to hand to the encoder (e.g. with a computed check digit). */
  value: string;
  note?: string;
}

const fail = (error: string, value = ''): Validation => ({ ok: false, error, value });

function checkedGs1(v: string, bodyLen: number, name: string): Validation {
  if (!/^\d+$/.test(v)) return fail(`${name} accepts digits only.`);
  if (v.length === bodyLen) {
    const full = v + gs1CheckDigit(v);
    return { ok: true, value: full, note: `Check digit ${full.slice(-1)} added.` };
  }
  if (v.length === bodyLen + 1) {
    const expected = gs1CheckDigit(v.slice(0, bodyLen));
    if (Number(v[bodyLen]) !== expected) {
      return fail(`Invalid check digit: the last digit should be ${expected}, not ${v[bodyLen]}.`);
    }
    return { ok: true, value: v };
  }
  return fail(`${name} needs ${bodyLen} digits (check digit added automatically) or ${bodyLen + 1} digits; you entered ${v.length}.`);
}

export function validateBarcode(format: BarcodeFormat, input: string): Validation {
  const v = input;
  if (!v) return fail('Enter a value to encode.');
  switch (format) {
    case 'CODE128':
      if (![...v].every((ch) => ch.charCodeAt(0) <= 0x7f)) return fail('Code 128 supports ASCII characters only (no accents or emoji).');
      return { ok: true, value: v };
    case 'CODE128A':
      if (![...v].every((ch) => ch.charCodeAt(0) <= 0x5f)) return fail('Code 128 A supports uppercase letters, digits, punctuation and control characters only.');
      return { ok: true, value: v };
    case 'CODE128B':
      if (!/^[\x20-\x7f]+$/.test(v)) return fail('Code 128 B supports printable ASCII characters only.');
      return { ok: true, value: v };
    case 'CODE128C':
      if (!/^\d+$/.test(v)) return fail('Code 128 C accepts digits only.');
      if (v.length % 2) return fail('Code 128 C needs an even number of digits.');
      return { ok: true, value: v };
    case 'EAN13':
      return checkedGs1(v, 12, 'EAN-13');
    case 'EAN8':
      return checkedGs1(v, 7, 'EAN-8');
    case 'UPC':
      return checkedGs1(v, 11, 'UPC-A');
    case 'ITF14':
      return checkedGs1(v, 13, 'ITF-14');
    case 'UPCE': {
      if (!/^\d+$/.test(v)) return fail('UPC-E accepts digits only.');
      if (v.length === 6) return { ok: true, value: v, note: 'Encoded with number system 0.' };
      if (v.length === 8) {
        if (v[0] !== '0' && v[0] !== '1') return fail('An 8-digit UPC-E must start with number system 0 or 1.');
        const upca = upcEToUpcA(v);
        const expected = gs1CheckDigit(upca.slice(0, 11));
        if (Number(v[7]) !== expected) return fail(`Invalid check digit: the last digit should be ${expected}, not ${v[7]}.`);
        return { ok: true, value: v };
      }
      return fail(`UPC-E needs 6 digits, or 8 digits including the number system and check digit; you entered ${v.length}.`);
    }
    case 'CODE39': {
      const upper = v.toUpperCase();
      if (!/^[0-9A-Z \-.$/+%]+$/.test(upper)) return fail('Code 39 supports A–Z, 0–9, space and - . $ / + % only.');
      return { ok: true, value: upper, note: upper !== v ? 'Letters were converted to uppercase.' : undefined };
    }
    case 'ITF':
      if (!/^\d+$/.test(v)) return fail('ITF accepts digits only.');
      if (v.length % 2) return fail(`ITF needs an even number of digits; you entered ${v.length}. Add a leading 0.`);
      return { ok: true, value: v };
    case 'MSI':
    case 'MSI10':
    case 'MSI11':
    case 'MSI1010':
    case 'MSI1110':
      if (!/^\d+$/.test(v)) return fail('MSI accepts digits only.');
      return { ok: true, value: v };
    case 'pharmacode': {
      if (!/^\d+$/.test(v)) return fail('Pharmacode accepts a whole number only.');
      const n = Number(v);
      if (n < 3 || n > 131070) return fail('Pharmacode values must be between 3 and 131070.');
      return { ok: true, value: String(n) };
    }
    case 'codabar': {
      const upper = v.toUpperCase();
      const m = /^([A-D])?([0-9\-$:/.+]+)([A-D])?$/.exec(upper);
      if (!m) return fail('Codabar supports digits and - $ : / . + with optional A–D start/stop letters.');
      if (Boolean(m[1]) !== Boolean(m[3])) return fail('Codabar needs both a start and a stop letter (A–D), or neither.');
      return { ok: true, value: upper };
    }
  }
}
