import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, Download, QrCode } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input, Label, NumberInput, Select, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useObjectUrl, useToolState } from '@/lib/hooks';
import { downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import { ColorField, RangeField } from '../image/components/controls';
import {
  buildEvent,
  buildGeo,
  buildMailto,
  buildSms,
  buildTel,
  buildVCard,
  buildWifi,
  EMPTY_VCARD,
  qrColorWarning,
  validateEvent,
  validateGeo,
  validatePhone,
  validateVCard,
  validateWifi,
  type EventConfig,
  type VCard,
  type WifiConfig,
} from './lib/content';

type Kind = 'text' | 'url' | 'wifi' | 'vcard' | 'email' | 'phone' | 'sms' | 'geo' | 'event';
type Ec = 'L' | 'M' | 'Q' | 'H';

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: 'url', label: 'URL' },
  { value: 'text', label: 'Text' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'vcard', label: 'Contact' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'sms', label: 'SMS' },
  { value: 'geo', label: 'Location' },
  { value: 'event', label: 'Event' },
];

function F({ label, children, className }: { label: string; children: (id: string) => ReactNode; className?: string }) {
  const id = `qr-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}

function friendlyQrError(e: unknown): string {
  const msg = errorMessage(e, 'Could not create the QR code.');
  if (/too big|amount of data/i.test(msg)) return 'The content is too long for a QR code at this error-correction level. Shorten it or choose a lower level (L holds the most).';
  return msg;
}

export default function QrGenerator() {
  const [kind, setKind] = useToolState<Kind>('qr-generator', 'kind', 'url');
  const [ec, setEc] = useToolState<Ec>('qr-generator', 'ec', 'M');
  const [size, setSize] = useToolState('qr-generator', 'size', 512);
  const [margin, setMargin] = useToolState('qr-generator', 'margin', 4);
  const [fg, setFg] = useToolState('qr-generator', 'fg', '#000000');
  const [bg, setBg] = useToolState('qr-generator', 'bg', '#ffffff');

  // Content is intentionally not persisted (it can contain passwords or personal data).
  const [text, setText] = useState('');
  const [url, setUrl] = useState('https://');
  const [wifi, setWifi] = useState<WifiConfig>({ ssid: '', password: '', security: 'WPA', hidden: false });
  const [vcard, setVcard] = useState<VCard>(EMPTY_VCARD);
  const [email, setEmail] = useState({ to: '', subject: '', body: '' });
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState({ to: '', message: '' });
  const [geo, setGeo] = useState<{ lat: number | ''; lng: number | ''; label: string }>({ lat: '', lng: '', label: '' });
  const [event, setEvent] = useState<EventConfig>({ title: '', location: '', description: '', allDay: false, start: '', end: '' });

  const payload = useMemo((): { value: string; error: string | null } => {
    switch (kind) {
      case 'text':
        return { value: text, error: null };
      case 'url': {
        const u = url.trim();
        if (!u || u === 'https://' || u === 'http://') return { value: '', error: null };
        // Browsers "fix" spaces, but phones reading the code would get a broken link.
        if (/\s/.test(u)) return { value: '', error: 'A URL cannot contain spaces. Remove them or replace them with %20.' };
        const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
        try {
          new URL(withScheme);
          return { value: withScheme, error: null };
        } catch {
          return { value: '', error: 'That URL is not valid.' };
        }
      }
      case 'wifi':
        if (!wifi.ssid && !wifi.password) return { value: '', error: null };
        return { value: buildWifi(wifi), error: validateWifi(wifi) };
      case 'vcard':
        if (Object.values(vcard).every((v) => !v.trim())) return { value: '', error: null };
        return { value: buildVCard(vcard), error: validateVCard(vcard) };
      case 'email':
        if (!email.to && !email.subject && !email.body) return { value: '', error: null };
        return {
          value: buildMailto(email.to, email.subject, email.body),
          error: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.to.trim()) ? null : 'Enter a valid email address.',
        };
      case 'phone':
        if (!phone) return { value: '', error: null };
        return { value: buildTel(phone), error: validatePhone(phone) };
      case 'sms':
        if (!sms.to && !sms.message) return { value: '', error: null };
        return { value: buildSms(sms.to, sms.message), error: validatePhone(sms.to) };
      case 'geo':
        if (geo.lat === '' && geo.lng === '') return { value: '', error: null };
        return { value: geo.lat !== '' && geo.lng !== '' ? buildGeo(geo.lat, geo.lng, geo.label) : '', error: validateGeo(geo.lat, geo.lng) };
      case 'event':
        if (!event.title && !event.start) return { value: '', error: null };
        return { value: buildEvent(event), error: validateEvent(event) };
    }
  }, [kind, text, url, wifi, vcard, email, phone, sms, geo, event]);

  const debounced = useDebouncedValue(payload, 150);
  const [svg, setSvg] = useState('');
  const [qrError, setQrError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!debounced.value || debounced.error) {
      setSvg('');
      setQrError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QR = (await import('qrcode')).default;
        const qr = QR.create(debounced.value, { errorCorrectionLevel: ec });
        // width gives the downloaded SVG the same intrinsic size as the PNG.
        const out = await QR.toString(debounced.value, { type: 'svg', errorCorrectionLevel: ec, margin, width: size, color: { dark: fg, light: bg } });
        if (cancelled) return;
        setVersion(qr.version);
        setSvg(out);
        setQrError(null);
      } catch (e) {
        if (!cancelled) {
          setSvg('');
          setQrError(friendlyQrError(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced, ec, margin, size, fg, bg]);

  const svgBlob = useMemo(() => (svg ? new Blob([svg], { type: 'image/svg+xml' }) : null), [svg]);
  const svgUrl = useObjectUrl(svgBlob);
  const colorWarning = qrColorWarning(fg, bg);
  const bytes = new TextEncoder().encode(debounced.value).length;

  async function pngBlob(): Promise<Blob> {
    const QR = (await import('qrcode')).default;
    const canvas = document.createElement('canvas');
    await QR.toCanvas(canvas, debounced.value, { errorCorrectionLevel: ec, margin, width: size, color: { dark: fg, light: bg } });
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'));
  }

  async function copyImage() {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
      toast('QR code copied as an image');
    } catch (e) {
      toast(
        e instanceof Error && e.message === 'unsupported'
          ? 'This browser cannot copy images. Download the PNG instead.'
          : 'Copy failed. Your browser blocked clipboard access.',
        'error',
      );
    }
  }

  const setW = (patch: Partial<WifiConfig>) => setWifi((w) => ({ ...w, ...patch }));
  const setV = (patch: Partial<VCard>) => setVcard((v) => ({ ...v, ...patch }));
  const setE = (patch: Partial<EventConfig>) => setEvent((v) => ({ ...v, ...patch }));

  return (
    <ToolStack>
      <div className="min-w-0">
        <Segmented label="Content type" value={kind} onChange={setKind} options={KINDS} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Content">
            <div className="grid gap-3 sm:grid-cols-2">
              {kind === 'text' && (
                <F label="Text" className="sm:col-span-2">
                  {(id) => <Textarea id={id} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Any text…" mono={false} />}
                </F>
              )}
              {kind === 'url' && (
                <F label="URL" className="sm:col-span-2">
                  {(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" />}
                </F>
              )}
              {kind === 'wifi' && (
                <>
                  <F label="Network name (SSID)">{(id) => <Input id={id} value={wifi.ssid} onChange={(e) => setW({ ssid: e.target.value })} autoComplete="off" />}</F>
                  <F label="Security">
                    {(id) => (
                      <Select id={id} value={wifi.security} onChange={(e) => setW({ security: e.target.value as WifiConfig['security'] })}>
                        <option value="WPA">WPA / WPA2</option>
                        <option value="SAE">WPA3 (SAE)</option>
                        <option value="WEP">WEP (old)</option>
                        <option value="nopass">No password</option>
                      </Select>
                    )}
                  </F>
                  {wifi.security !== 'nopass' && (
                    <F label="Password">{(id) => <Input id={id} type="text" value={wifi.password} onChange={(e) => setW({ password: e.target.value })} autoComplete="off" spellCheck={false} />}</F>
                  )}
                  <Checkbox label="Hidden network" checked={wifi.hidden} onChange={(v) => setW({ hidden: v })} className="self-end pb-2" />
                </>
              )}
              {kind === 'vcard' && (
                <>
                  <F label="First name">{(id) => <Input id={id} value={vcard.firstName} onChange={(e) => setV({ firstName: e.target.value })} />}</F>
                  <F label="Last name">{(id) => <Input id={id} value={vcard.lastName} onChange={(e) => setV({ lastName: e.target.value })} />}</F>
                  <F label="Organization">{(id) => <Input id={id} value={vcard.organization} onChange={(e) => setV({ organization: e.target.value })} />}</F>
                  <F label="Job title">{(id) => <Input id={id} value={vcard.title} onChange={(e) => setV({ title: e.target.value })} />}</F>
                  <F label="Mobile">{(id) => <Input id={id} type="tel" value={vcard.mobile} onChange={(e) => setV({ mobile: e.target.value })} />}</F>
                  <F label="Work phone">{(id) => <Input id={id} type="tel" value={vcard.phone} onChange={(e) => setV({ phone: e.target.value })} />}</F>
                  <F label="Email">{(id) => <Input id={id} type="email" value={vcard.email} onChange={(e) => setV({ email: e.target.value })} />}</F>
                  <F label="Website">{(id) => <Input id={id} value={vcard.website} onChange={(e) => setV({ website: e.target.value })} />}</F>
                  <F label="Street" className="sm:col-span-2">{(id) => <Input id={id} value={vcard.street} onChange={(e) => setV({ street: e.target.value })} />}</F>
                  <F label="City">{(id) => <Input id={id} value={vcard.city} onChange={(e) => setV({ city: e.target.value })} />}</F>
                  <F label="Region / state">{(id) => <Input id={id} value={vcard.region} onChange={(e) => setV({ region: e.target.value })} />}</F>
                  <F label="Postal code">{(id) => <Input id={id} value={vcard.postcode} onChange={(e) => setV({ postcode: e.target.value })} />}</F>
                  <F label="Country">{(id) => <Input id={id} value={vcard.country} onChange={(e) => setV({ country: e.target.value })} />}</F>
                  <F label="Note" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={vcard.note} onChange={(e) => setV({ note: e.target.value })} mono={false} />}</F>
                </>
              )}
              {kind === 'email' && (
                <>
                  <F label="To" className="sm:col-span-2">{(id) => <Input id={id} type="email" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} placeholder="name@example.com" />}</F>
                  <F label="Subject" className="sm:col-span-2">{(id) => <Input id={id} value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />}</F>
                  <F label="Body" className="sm:col-span-2">{(id) => <Textarea id={id} rows={4} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} mono={false} />}</F>
                </>
              )}
              {kind === 'phone' && <F label="Phone number">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />}</F>}
              {kind === 'sms' && (
                <>
                  <F label="Phone number">{(id) => <Input id={id} type="tel" value={sms.to} onChange={(e) => setSms({ ...sms, to: e.target.value })} />}</F>
                  <F label="Message" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={sms.message} onChange={(e) => setSms({ ...sms, message: e.target.value })} mono={false} />}</F>
                </>
              )}
              {kind === 'geo' && (
                <>
                  <F label="Latitude">{(id) => <NumberInput id={id} value={geo.lat} onChange={(v) => setGeo({ ...geo, lat: v })} step={0.000001} placeholder="48.858370" />}</F>
                  <F label="Longitude">{(id) => <NumberInput id={id} value={geo.lng} onChange={(v) => setGeo({ ...geo, lng: v })} step={0.000001} placeholder="2.294481" />}</F>
                  <F label="Label (optional)" className="sm:col-span-2">{(id) => <Input id={id} value={geo.label} onChange={(e) => setGeo({ ...geo, label: e.target.value })} />}</F>
                </>
              )}
              {kind === 'event' && (
                <>
                  <F label="Title" className="sm:col-span-2">{(id) => <Input id={id} value={event.title} onChange={(e) => setE({ title: e.target.value })} />}</F>
                  <Checkbox label="All-day event" checked={event.allDay} onChange={(v) => setE({ allDay: v, start: '', end: '' })} className="sm:col-span-2" />
                  <F label="Starts">{(id) => <Input id={id} type={event.allDay ? 'date' : 'datetime-local'} value={event.start} onChange={(e) => setE({ start: e.target.value })} />}</F>
                  <F label="Ends">{(id) => <Input id={id} type={event.allDay ? 'date' : 'datetime-local'} value={event.end} onChange={(e) => setE({ end: e.target.value })} />}</F>
                  <F label="Location" className="sm:col-span-2">{(id) => <Input id={id} value={event.location} onChange={(e) => setE({ location: e.target.value })} />}</F>
                  <F label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={event.description} onChange={(e) => setE({ description: e.target.value })} mono={false} />}</F>
                </>
              )}
            </div>
            {kind === 'event' && !event.allDay && <p className="mt-2 text-[12.5px] text-fg-muted">Times use your device's time zone and are stored in UTC.</p>}
          </Panel>
          <Panel title="Style">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <Label>Error correction</Label>
                <Segmented
                  label="Error correction"
                  value={ec}
                  onChange={setEc}
                  options={[
                    { value: 'L', label: 'L 7%', title: 'Low: most data capacity' },
                    { value: 'M', label: 'M 15%', title: 'Medium (default)' },
                    { value: 'Q', label: 'Q 25%', title: 'Quartile' },
                    { value: 'H', label: 'H 30%', title: 'High: survives damage or a logo overlay' },
                  ]}
                />
              </div>
              <RangeField label="PNG size" value={size} min={128} max={2048} step={32} onChange={setSize} format={(v) => `${v} px`} />
              <RangeField label="Margin (quiet zone)" value={margin} min={0} max={10} onChange={setMargin} format={(v) => `${v} modules`} />
              <div className="flex flex-wrap gap-4">
                <ColorField label="Code color" value={fg} onChange={setFg} />
                <ColorField label="Background" value={bg} onChange={setBg} />
              </div>
            </div>
            {margin < 2 && <p className="mt-3 text-[12.5px] text-warning">A margin below 2 modules can make the code hard to scan on busy backgrounds (4 is the standard).</p>}
            {colorWarning && (
              <Alert tone="warning" className="mt-3">
                {colorWarning}
              </Alert>
            )}
          </Panel>
        </div>
        <Panel title="QR code" className="lg:sticky lg:top-4 lg:self-start" actions={svg && version ? <Badge>Version {version}</Badge> : undefined}>
          <ErrorMessage error={payload.error ?? qrError} />
          {svgUrl && !payload.error ? (
            <div className="flex flex-col gap-3">
              <div className="flex justify-center rounded-lg border border-line p-3" style={{ backgroundColor: bg }}>
                <img src={svgUrl} alt="Generated QR code" className="aspect-square w-full max-w-[320px]" style={{ imageRendering: 'pixelated' }} />
              </div>
              <p className="text-center text-[12.5px] text-fg-muted">
                {bytes.toLocaleString()} bytes encoded · error correction {ec}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="primary"
                  icon={Download}
                  onClick={async () => {
                    try {
                      downloadBlob(await pngBlob(), 'qr-code.png');
                    } catch (e) {
                      toast(friendlyQrError(e), 'error');
                    }
                  }}
                >
                  PNG
                </Button>
                <Button icon={Download} onClick={() => downloadBlob(svg, 'qr-code.svg', 'image/svg+xml')}>
                  SVG
                </Button>
                <Button icon={Copy} className="col-span-2" onClick={copyImage}>
                  Copy image
                </Button>
              </div>
              <details className="text-[12.5px]">
                <summary className="cursor-pointer text-fg-muted">Encoded content ({formatBytes(bytes)})</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-line bg-surface-sunken p-2 font-mono text-[12px] break-all whitespace-pre-wrap text-fg">{debounced.value}</pre>
              </details>
            </div>
          ) : (
            !(payload.error ?? qrError) && (
              <EmptyState icon={QrCode} title="Your QR code appears here">
                Fill in the content on the left.
              </EmptyState>
            )
          )}
        </Panel>
      </div>
    </ToolStack>
  );
}
