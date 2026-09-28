import Bowser from 'bowser';

export interface UserAgentInfo {
  /** True when the client was identified from a leading "product/version" token instead of browser rules. */
  fromProductToken: boolean;
  browser: { name: string | null; version: string | null };
  engine: { name: string | null; version: string | null };
  os: { name: string | null; version: string | null; versionName: string | null };
  platform: { type: string | null; vendor: string | null; model: string | null };
}

export const SAMPLE_USER_AGENTS: Array<{ label: string; ua: string }> = [
  {
    label: 'Chrome · Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  },
  {
    label: 'Safari · iPhone',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Firefox · Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  },
  {
    label: 'Edge · macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  },
  {
    label: 'Samsung Internet · Android',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  },
  {
    label: 'Safari · iPad',
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Googlebot',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  { label: 'curl', ua: 'curl/8.9.1' },
];

const orNull = (v: string | undefined) => (v === undefined || v === '' ? null : v);

export function parseUserAgent(ua: string): UserAgentInfo {
  if (!ua.trim()) throw new Error('Enter a User-Agent string.');
  const r = Bowser.parse(ua.trim());
  let browser = { name: orNull(r.browser.name), version: orNull(r.browser.version) };
  let fromProductToken = false;
  if (!browser.name) {
    // Non-browser clients usually send a bare product token such as "curl/8.9.1".
    const m = /^([A-Za-z][\w.-]*)\/([\w.-]+)/.exec(ua.trim());
    if (m && m[1].toLowerCase() !== 'mozilla') {
      browser = { name: m[1], version: m[2] };
      fromProductToken = true;
    }
  }
  return {
    fromProductToken,
    browser,
    engine: { name: orNull(r.engine.name), version: orNull(r.engine.version) },
    os: { name: orNull(r.os.name), version: orNull(r.os.version), versionName: orNull(r.os.versionName) },
    platform: { type: orNull(r.platform.type), vendor: orNull(r.platform.vendor), model: orNull(r.platform.model) },
  };
}
