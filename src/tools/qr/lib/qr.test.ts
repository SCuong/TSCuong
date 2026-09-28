import { describe, expect, it } from 'vitest';
import {
  buildEvent,
  buildGeo,
  buildMailto,
  buildSms,
  buildTel,
  buildVCard,
  buildWifi,
  contrastRatio,
  detectContent,
  EMPTY_VCARD,
  escapeText,
  escapeWifi,
  parseVCard,
  parseWifi,
  qrColorWarning,
  unescapeText,
  validateEvent,
  validateGeo,
  validatePhone,
  validateVCard,
  validateWifi,
} from './content';
import { gs1CheckDigit, upcEToUpcA, validateBarcode } from './barcode';

describe('Wi-Fi', () => {
  it('escapes special characters per spec', () => {
    expect(escapeWifi('a;b,c:d\\e"f')).toBe('a\\;b\\,c\\:d\\\\e\\"f');
  });

  it('builds WIFI strings', () => {
    expect(buildWifi({ ssid: 'Home', password: 'pa;ss:word', security: 'WPA', hidden: false })).toBe('WIFI:T:WPA;S:Home;P:pa\\;ss\\:word;;');
    expect(buildWifi({ ssid: 'Café ☕', password: '', security: 'nopass', hidden: true })).toBe('WIFI:T:nopass;S:Café ☕;H:true;;');
  });

  it('round-trips through the parser, including emoji and tricky passwords', () => {
    for (const cfg of [
      { ssid: 'My "Net";', password: 'p\\a,s;s:w"o', security: 'WPA' as const, hidden: true },
      { ssid: '😀 Wi-Fi', password: '12345678', security: 'SAE' as const, hidden: false },
      { ssid: 'Open', password: '', security: 'nopass' as const, hidden: false },
      { ssid: 'Old', password: 'abcde', security: 'WEP' as const, hidden: false },
    ]) {
      expect(parseWifi(buildWifi(cfg))).toEqual(cfg);
    }
  });

  it('parses fields in any order and rejects non-wifi', () => {
    expect(parseWifi('WIFI:S:Net;T:WPA;P:secret123;;')).toEqual({ ssid: 'Net', password: 'secret123', security: 'WPA', hidden: false });
    expect(parseWifi('hello')).toBeNull();
    expect(parseWifi('WIFI:T:WPA;;')).toBeNull();
  });

  it('validates', () => {
    expect(validateWifi({ ssid: '', password: '', security: 'WPA', hidden: false })).toMatch(/network name/);
    expect(validateWifi({ ssid: 'x', password: 'short', security: 'WPA', hidden: false })).toMatch(/8–63/);
    expect(validateWifi({ ssid: 'x', password: 'z'.repeat(64), security: 'WPA', hidden: false })).toMatch(/8–63/);
    expect(validateWifi({ ssid: 'x', password: 'ab'.repeat(32), security: 'WPA', hidden: false })).toBeNull();
    expect(validateWifi({ ssid: 'x'.repeat(33), password: '', security: 'nopass', hidden: false })).toMatch(/32 bytes/);
    expect(validateWifi({ ssid: 'x', password: 'abc', security: 'WEP', hidden: false })).toMatch(/WEP/);
  });
});

describe('vCard', () => {
  const card = {
    ...EMPTY_VCARD,
    firstName: 'Jöhn',
    lastName: 'Doe, Jr.',
    organization: 'Acme; Inc',
    title: 'CEO',
    mobile: '+1 555 0100',
    email: 'john@example.com',
    website: 'https://example.com',
    street: '1 Main St',
    city: 'Springfield',
    country: 'USA',
    note: 'Line 1\nLine 2 😀',
  };

  it('builds vCard 3.0 with CRLF and escaping', () => {
    const v = buildVCard(card);
    expect(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(v).toContain('N:Doe\\, Jr.;Jöhn;;;');
    expect(v).toContain('FN:Jöhn Doe\\, Jr.');
    expect(v).toContain('ORG:Acme\\; Inc');
    expect(v).toContain('NOTE:Line 1\\nLine 2 😀');
    expect(v).toContain('ADR;TYPE=WORK:;;1 Main St;Springfield;;;USA');
    expect(v.endsWith('END:VCARD')).toBe(true);
    expect(v.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });

  it('parses what it builds', () => {
    const p = parseVCard(buildVCard(card))!;
    expect(p.name).toBe('Jöhn Doe, Jr.');
    expect(p.lastName).toBe('Doe, Jr.');
    expect(p.organization).toBe('Acme; Inc');
    expect(p.phones).toEqual(['+1 555 0100']);
    expect(p.emails).toEqual(['john@example.com']);
    expect(p.note).toBe('Line 1\nLine 2 😀');
    expect(p.addresses).toEqual(['1 Main St, Springfield, USA']);
  });

  it('unfolds folded lines and handles vCard 4 / grouped properties', () => {
    const text = 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Very Long\r\n  Name\r\nitem1.EMAIL;TYPE=work:a@b.co\r\nTEL;VALUE=uri:tel:+123\r\nEND:VCARD';
    const p = parseVCard(text)!;
    expect(p.name).toBe('Very Long Name');
    expect(p.emails).toEqual(['a@b.co']);
    expect(p.phones).toEqual(['+123']);
  });

  it('validates', () => {
    expect(validateVCard(EMPTY_VCARD)).toMatch(/name/);
    expect(validateVCard({ ...EMPTY_VCARD, firstName: 'a', email: 'bad' })).toMatch(/email/);
    expect(validateVCard({ ...EMPTY_VCARD, organization: 'Org' })).toBeNull();
  });

  it('escapeText/unescapeText round-trip', () => {
    const s = 'a\\b,c;d\ne';
    expect(unescapeText(escapeText(s))).toBe(s);
  });
});

describe('other payloads', () => {
  it('mailto encodes subject and body', () => {
    expect(buildMailto('a@b.co', 'Hi & bye', 'L1\nL2')).toBe('mailto:a@b.co?subject=Hi%20%26%20bye&body=L1%0D%0AL2');
    expect(buildMailto('a@b.co', '', '')).toBe('mailto:a@b.co');
  });
  it('phone and SMS', () => {
    expect(buildTel('+1 (555) 010-0')).toBe('tel:+15550100');
    expect(buildSms('+1 555', 'Hello: there')).toBe('SMSTO:+1555:Hello: there');
    expect(validatePhone('abc')).toBeTruthy();
    expect(validatePhone('+44 20 7946 0000')).toBeNull();
  });
  it('geo', () => {
    expect(buildGeo(48.8583701, 2.2944813)).toBe('geo:48.85837,2.294481');
    expect(buildGeo(1, 2, 'Café')).toBe(`geo:1,2?q=${encodeURIComponent('1,2(Café)')}`);
    expect(validateGeo(91, 0)).toMatch(/Latitude/);
    expect(validateGeo(0, -181)).toMatch(/Longitude/);
    expect(validateGeo('', 1)).toBeTruthy();
    expect(validateGeo(-90, 180)).toBeNull();
  });
  it('calendar events', () => {
    const now = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
    const timed = buildEvent({ title: 'Launch, party; v2', location: 'HQ', description: 'Bring\nsnacks', allDay: false, start: '2024-03-01T10:00:00Z', end: '2024-03-01T11:30:00Z' }, now, 'uid-1');
    expect(timed).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0');
    expect(timed).toContain('UID:uid-1\r\nDTSTAMP:20240101T120000Z');
    expect(timed).toContain('SUMMARY:Launch\\, party\\; v2');
    expect(timed).toContain('DTSTART:20240301T100000Z\r\nDTEND:20240301T113000Z');
    expect(timed).toContain('DESCRIPTION:Bring\\nsnacks');
    const allDay = buildEvent({ title: 'Holiday', location: '', description: '', allDay: true, start: '2024-12-31', end: '' }, now, 'u');
    expect(allDay).toContain('DTSTART;VALUE=DATE:20241231\r\nDTEND;VALUE=DATE:20250101');
    expect(validateEvent({ title: '', location: '', description: '', allDay: false, start: '', end: '' })).toMatch(/title/);
    expect(validateEvent({ title: 'x', location: '', description: '', allDay: false, start: '2024-01-02T10:00', end: '2024-01-01T10:00' })).toMatch(/before/);
  });
});

describe('detectContent', () => {
  it('detects Wi-Fi with fields', () => {
    const d = detectContent('WIFI:T:WPA;S:Home\\;Net;P:secret123;;');
    expect(d.kind).toBe('wifi');
    expect(d.fields.find((f) => f.label === 'Network (SSID)')?.value).toBe('Home;Net');
    expect(d.fields.find((f) => f.label === 'Password')?.secret).toBe(true);
  });
  it('detects URLs, emails, phones, sms, geo, vcards and events', () => {
    expect(detectContent('https://example.com/a?b=1')).toMatchObject({ kind: 'url', href: 'https://example.com/a?b=1' });
    expect(detectContent('www.example.com').href).toBe('https://www.example.com');
    expect(detectContent('javascript:alert(1)').kind).toBe('text');
    expect(detectContent('mailto:a@b.co?subject=Hi%20there').fields).toContainEqual({ label: 'Subject', value: 'Hi there' });
    expect(detectContent('tel:+123').kind).toBe('tel');
    expect(detectContent('SMSTO:+123:hello').fields).toContainEqual({ label: 'Message', value: 'hello' });
    expect(detectContent('sms:+123?body=hi%20you').fields).toContainEqual({ label: 'Message', value: 'hi you' });
    expect(detectContent('geo:48.85,2.29').kind).toBe('geo');
    expect(detectContent(buildVCard({ ...EMPTY_VCARD, firstName: 'A', email: 'a@b.co' })).kind).toBe('vcard');
    expect(detectContent(buildEvent({ title: 'T', location: '', description: '', allDay: true, start: '2024-01-01', end: '' })).kind).toBe('event');
    expect(detectContent('just some text').kind).toBe('text');
  });
});

describe('QR colors', () => {
  it('contrast ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1);
    expect(contrastRatio('bad', '#fff')).toBeNull();
  });
  it('warnings', () => {
    expect(qrColorWarning('#000000', '#ffffff')).toBeNull();
    expect(qrColorWarning('#ffffff', '#000000')).toMatch(/lighter/);
    expect(qrColorWarning('#999999', '#bbbbbb')).toMatch(/Low contrast/);
  });
});

describe('barcode validation', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('590123412345')).toBe(7);
    expect(gs1CheckDigit('9638507')).toBe(4);
    expect(gs1CheckDigit('03600029145')).toBe(2);
    expect(gs1CheckDigit('1540014128876')).toBe(3);
  });
  it('EAN-13: adds or verifies the check digit', () => {
    expect(validateBarcode('EAN13', '590123412345')).toMatchObject({ ok: true, value: '5901234123457' });
    expect(validateBarcode('EAN13', '5901234123457')).toMatchObject({ ok: true });
    const bad = validateBarcode('EAN13', '5901234123450');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/should be 7/);
    expect(validateBarcode('EAN13', '123').error).toMatch(/12 digits/);
    expect(validateBarcode('EAN13', '59012341234a').error).toMatch(/digits only/);
  });
  it('EAN-8, UPC-A, ITF-14', () => {
    expect(validateBarcode('EAN8', '9638507').value).toBe('96385074');
    expect(validateBarcode('UPC', '036000291452').ok).toBe(true);
    expect(validateBarcode('UPC', '036000291453').ok).toBe(false);
    expect(validateBarcode('ITF14', '1540014128876').value).toBe('15400141288763');
  });
  it('UPC-E expansion and validation', () => {
    expect(upcEToUpcA('01234565')).toBe('012345000065');
    expect(upcEToUpcA('04252614')).toBe('042100005264');
    expect(validateBarcode('UPCE', '01234565').ok).toBe(true);
    expect(validateBarcode('UPCE', '01234564').error).toMatch(/should be 5/);
    expect(validateBarcode('UPCE', '123456').ok).toBe(true);
    expect(validateBarcode('UPCE', '21234565').error).toMatch(/number system/);
  });
  it('Code 128 variants', () => {
    expect(validateBarcode('CODE128', 'Hello 😀').ok).toBe(false);
    expect(validateBarcode('CODE128', 'Hello\tWorld').ok).toBe(true);
    expect(validateBarcode('CODE128A', 'abc').ok).toBe(false);
    expect(validateBarcode('CODE128B', 'abc').ok).toBe(true);
    expect(validateBarcode('CODE128C', '123').error).toMatch(/even/);
    expect(validateBarcode('CODE128C', '1234').ok).toBe(true);
  });
  it('Code 39, ITF, MSI, pharmacode, codabar', () => {
    expect(validateBarcode('CODE39', 'abc-1')).toMatchObject({ ok: true, value: 'ABC-1' });
    expect(validateBarcode('CODE39', 'a_b').ok).toBe(false);
    expect(validateBarcode('ITF', '12345').error).toMatch(/even/);
    expect(validateBarcode('MSI', '12a').ok).toBe(false);
    expect(validateBarcode('pharmacode', '2').ok).toBe(false);
    expect(validateBarcode('pharmacode', '131070').ok).toBe(true);
    expect(validateBarcode('pharmacode', '131071').ok).toBe(false);
    expect(validateBarcode('codabar', 'a123b')).toMatchObject({ ok: true, value: 'A123B' });
    expect(validateBarcode('codabar', 'A123').error).toMatch(/both/);
    expect(validateBarcode('codabar', '12$34').ok).toBe(true);
  });
  it('rejects empty input', () => {
    expect(validateBarcode('CODE128', '').ok).toBe(false);
  });
});
