import Bowser from 'bowser';

export interface UserAgentInfo {
  /** True when the client was identified from a leading "product/version" token instead of browser rules. */
  fromProductToken: boolean;
  browser: { name: string | null; version: string | null };
  engine: { name: string | null; version: string | null };
  os: { name: string | null; version: string | null; versionName: string | null };
  platform: { type: string | null; vendor: string | null; model: string | null };
  /** Caveats about values that browsers freeze or hide in the User-Agent string. */
  notes: string[];
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
  const text = ua.trim();
  if (!text) throw new Error('Enter a User-Agent string.');
  const r = Bowser.parse(text);
  let browser = { name: orNull(r.browser.name), version: orNull(r.browser.version) };
  let fromProductToken = false;
  if (!browser.name) {
    // Non-browser clients usually send a bare product token such as "curl/8.9.1".
    const m = /^([A-Za-z][\w.-]*)\/([\w.-]+)/.exec(text);
    if (m && m[1].toLowerCase() !== 'mozilla') {
      browser = { name: m[1], version: m[2] };
      fromProductToken = true;
    }
  }
  const engine = { name: orNull(r.engine.name), version: orNull(r.engine.version) };
  const os = { name: orNull(r.os.name), version: orNull(r.os.version), versionName: orNull(r.os.versionName) };
  const platform = { type: orNull(r.platform.type), vendor: orNull(r.platform.vendor), model: orNull(r.platform.model) };
  const notes: string[] = [];

  // Bowser reports the retired EdgeHTML engine for Edge on Android ("EdgA") and iOS ("EdgiOS").
  if (/\bEdgA\//.test(text)) {
    engine.name = 'Blink';
    engine.version = null;
  }
  // Every browser on iOS and iPadOS must use Apple's WebKit engine.
  if (os.name === 'iOS' || /\((?:iPhone|iPad|iPod)\b/.test(text)) {
    engine.name = 'WebKit';
    engine.version = /AppleWebKit\/([\d.]+)/.exec(text)?.[1] ?? engine.version;
  }
  // "Gecko/20100101" is a frozen build date, not a version: Gecko's version is the "rv:" value.
  if (engine.name === 'Gecko') {
    const rv = /\brv:([\d.]+)/.exec(text);
    if (rv) engine.version = rv[1];
  }
  // Chromebooks are laptops/desktops, which Bowser leaves blank.
  if (!platform.type && os.name === 'Chrome OS') platform.type = 'desktop';

  if (os.name === 'Windows' && os.version === 'NT 10.0') {
    os.versionName = '10 or 11';
    notes.push('Windows 11 still says “Windows NT 10.0” in the User-Agent, so Windows 10 and 11 look the same here. Client Hints (a platform version of 13 or higher) tell them apart.');
  }
  if (os.name === 'macOS' && os.version === '10.15.7') {
    os.versionName = null;
    notes.push('Browsers freeze the macOS version at 10.15.7, so the Mac may run a newer macOS. iPads in desktop mode send this same Mac string.');
  }
  if (os.name === 'Android' && /; K\)/.test(text)) {
    notes.push('This is Chrome’s reduced User-Agent: “Android 10; K” is a fixed placeholder, not the real Android version or device model.');
  }
  if (os.name === 'iOS' && browser.name === 'Safari' && Number.parseInt(browser.version ?? '', 10) >= 26) {
    notes.push('Safari 26 and later keep an older iOS version in the User-Agent, so the real iOS version may be newer.');
  }
  if (/\bChrome\/\d+\.0\.0\.0\b/.test(text)) {
    notes.push('Chromium-based browsers report only the major version (the rest is “0.0.0”); Client Hints give the full version.');
  }
  return { fromProductToken, browser, engine, os, platform, notes };
}
