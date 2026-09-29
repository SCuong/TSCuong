/** Explains JWT claims and evaluates the time-based ones (exp, nbf, iat) against a clock. */

import { humanizeDuration, isoFromSeconds, relativeTime } from '../../shared-b/time';
import type { Issue } from './decode';

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export interface ClaimDoc {
  name: string;
  description: string;
  /** Value is a NumericDate (seconds since the Unix epoch). */
  date?: boolean;
}

export const REGISTERED_CLAIMS = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'] as const;

export const CLAIM_DOCS: Record<string, ClaimDoc> = {
  iss: { name: 'Issuer', description: 'Who created and signed the token.' },
  sub: { name: 'Subject', description: 'Whom the token is about, usually a user or client ID.' },
  aud: { name: 'Audience', description: 'Who the token is intended for; recipients must check it names them.' },
  exp: { name: 'Expiration time', description: 'The token must not be accepted on or after this time.', date: true },
  nbf: { name: 'Not before', description: 'The token must not be accepted before this time.', date: true },
  iat: { name: 'Issued at', description: 'When the token was created.', date: true },
  jti: { name: 'JWT ID', description: 'Unique identifier, used to prevent replay.' },
  // OpenID Connect
  auth_time: { name: 'Authentication time', description: 'When the user last actively signed in.', date: true },
  nonce: { name: 'Nonce', description: 'Value that ties an ID token to the client’s sign-in request.' },
  azp: { name: 'Authorized party', description: 'The client the ID token was issued to.' },
  acr: { name: 'Authentication context', description: 'Assurance level of the sign-in.' },
  amr: { name: 'Authentication methods', description: 'How the user signed in (e.g. pwd, otp, mfa).' },
  at_hash: { name: 'Access token hash', description: 'Binds an ID token to an access token.' },
  c_hash: { name: 'Code hash', description: 'Binds an ID token to an authorization code.' },
  sid: { name: 'Session ID', description: 'Identifier of the sign-in session.' },
  name: { name: 'Full name', description: 'User’s full display name.' },
  given_name: { name: 'Given name', description: 'User’s first name.' },
  family_name: { name: 'Family name', description: 'User’s last name.' },
  middle_name: { name: 'Middle name', description: 'User’s middle name.' },
  nickname: { name: 'Nickname', description: 'Casual name of the user.' },
  preferred_username: { name: 'Preferred username', description: 'Shorthand name the user wants to be called.' },
  profile: { name: 'Profile URL', description: 'User’s profile page.' },
  picture: { name: 'Picture URL', description: 'User’s profile picture.' },
  website: { name: 'Website', description: 'User’s web page or blog.' },
  email: { name: 'Email', description: 'User’s email address.' },
  email_verified: { name: 'Email verified', description: 'Whether the email address was verified.' },
  gender: { name: 'Gender', description: 'User’s gender.' },
  birthdate: { name: 'Birthdate', description: 'User’s birthday (YYYY-MM-DD).' },
  zoneinfo: { name: 'Time zone', description: 'User’s time zone (e.g. Europe/Paris).' },
  locale: { name: 'Locale', description: 'User’s locale (e.g. en-US).' },
  phone_number: { name: 'Phone number', description: 'User’s phone number.' },
  phone_number_verified: { name: 'Phone verified', description: 'Whether the phone number was verified.' },
  address: { name: 'Address', description: 'User’s postal address.' },
  updated_at: { name: 'Updated at', description: 'When the user’s profile last changed.', date: true },
  // OAuth / token exchange
  scope: { name: 'Scope', description: 'Space-separated permissions granted to the token.' },
  scp: { name: 'Scopes', description: 'Permissions granted to the token (list form).' },
  client_id: { name: 'Client ID', description: 'The OAuth client the token was issued to.' },
  cnf: { name: 'Confirmation', description: 'Key the holder must prove possession of (RFC 7800).' },
  act: { name: 'Actor', description: 'Party acting on behalf of the subject (RFC 8693).' },
  may_act: { name: 'May act', description: 'Who is allowed to act on behalf of the subject.' },
  roles: { name: 'Roles', description: 'Roles assigned to the subject.' },
  groups: { name: 'Groups', description: 'Groups the subject belongs to.' },
  entitlements: { name: 'Entitlements', description: 'Individual permissions of the subject.' },
  tid: { name: 'Tenant ID', description: 'Directory/tenant that issued the token (Microsoft Entra ID).' },
  oid: { name: 'Object ID', description: 'Immutable user ID (Microsoft Entra ID).' },
  upn: { name: 'User principal name', description: 'Sign-in name of the user (Microsoft).' },
};

export interface ClaimRow {
  key: string;
  doc?: ClaimDoc;
  registered: boolean;
  value: unknown;
  /** The value as text: strings as-is, everything else as compact JSON. */
  display: string;
  date?: { seconds: number; iso: string; relative: string };
  status?: { tone: Tone; text: string };
  problem?: string;
}

export interface TimeSummary {
  tone: Tone;
  title: string;
  detail?: string;
}

export interface ClaimsReport {
  rows: ClaimRow[];
  summary: TimeSummary;
  issues: Issue[];
  /** exp − iat, when both are present. */
  lifetime?: string;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Validates a NumericDate claim; returns the number or a problem description. */
export function readNumericDate(value: unknown): { seconds: number } | { problem: string } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Math.abs(value) > 1e11) {
      return { problem: 'This looks like milliseconds. JWT times are seconds since 1970 (NumericDate), so this date is far in the future.' };
    }
    return { seconds: value };
  }
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return { problem: 'This is a string. JWT times must be JSON numbers (seconds since 1970), so most libraries ignore or reject it.' };
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return { problem: 'This is a date string. JWT times must be JSON numbers (seconds since 1970).' };
  }
  return { problem: 'JWT times must be JSON numbers (seconds since 1970).' };
}

function typeProblem(key: string, value: unknown): string | undefined {
  if (key === 'iss' || key === 'sub' || key === 'jti') {
    return typeof value === 'string' ? undefined : `“${key}” must be a string.`;
  }
  if (key === 'aud') {
    if (typeof value === 'string') return undefined;
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return undefined;
    return '“aud” must be a string or an array of strings.';
  }
  return undefined;
}

/**
 * Builds the claims table and an overall validity summary.
 * @param nowSeconds current time in seconds since the epoch (may be fractional)
 */
export function evaluateClaims(claims: Record<string, unknown>, nowSeconds: number): ClaimsReport {
  const rows: ClaimRow[] = [];
  const issues: Issue[] = [];
  const times: Partial<Record<'exp' | 'nbf' | 'iat', number>> = {};

  const keys = Object.keys(claims);
  const ordered = [
    ...REGISTERED_CLAIMS.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !(REGISTERED_CLAIMS as readonly string[]).includes(k)),
  ];

  for (const key of ordered) {
    const value = claims[key];
    const doc = CLAIM_DOCS[key];
    const row: ClaimRow = {
      key,
      doc,
      registered: (REGISTERED_CLAIMS as readonly string[]).includes(key),
      value,
      display: displayValue(value),
    };
    if (doc?.date) {
      const read = readNumericDate(value);
      if ('problem' in read) {
        row.problem = read.problem;
        if (key === 'exp' || key === 'nbf' || key === 'iat') {
          issues.push({ level: 'warning', message: `“${key}” is invalid: ${read.problem}` });
        }
      } else {
        const delta = read.seconds - nowSeconds;
        const iso = isoFromSeconds(read.seconds);
        row.date = { seconds: read.seconds, iso: iso ?? 'out of range', relative: relativeTime(delta) };
        if (key === 'exp' || key === 'nbf' || key === 'iat') times[key] = read.seconds;
        if (key === 'exp') {
          row.status =
            delta <= 0
              ? { tone: 'danger', text: `Expired ${humanizeDuration(delta)} ago` }
              : { tone: 'success', text: `Expires in ${humanizeDuration(delta)}` };
        } else if (key === 'nbf') {
          row.status =
            delta > 0
              ? { tone: 'warning', text: `Not valid for another ${humanizeDuration(delta)}` }
              : { tone: 'success', text: `Valid since ${humanizeDuration(delta)} ago` };
        } else if (key === 'iat') {
          row.status =
            delta > 60
              ? { tone: 'warning', text: `Issued ${humanizeDuration(delta)} in the future` }
              : { tone: 'neutral', text: delta > 0 ? 'Issued just now' : `Issued ${humanizeDuration(delta)} ago` };
        } else {
          row.status = { tone: 'neutral', text: relativeTime(delta).replace(/^./, (c) => c.toUpperCase()) };
        }
      }
    } else {
      row.problem = typeProblem(key, value);
      if (row.problem) issues.push({ level: 'warning', message: row.problem });
    }
    rows.push(row);
  }

  const { exp, nbf, iat } = times;
  if (exp !== undefined && nbf !== undefined && nbf >= exp) {
    issues.push({ level: 'warning', message: '“nbf” is not before “exp”, so there is no moment when this token is valid.' });
  }
  if (exp !== undefined && iat !== undefined && iat > exp) {
    issues.push({ level: 'warning', message: '“iat” is after “exp”: the token expired before it was issued.' });
  }
  if (iat !== undefined && iat - nowSeconds > 60) {
    issues.push({
      level: 'warning',
      message: `The token was issued ${humanizeDuration(iat - nowSeconds)} in the future. The issuer’s or this device’s clock is probably wrong.`,
    });
  }
  if (!('exp' in claims)) {
    issues.push({ level: 'info', message: 'There is no “exp” claim, so this token never expires unless the server enforces its own limit.' });
  }

  let summary: TimeSummary;
  if (exp !== undefined && exp <= nowSeconds) {
    summary = { tone: 'danger', title: `Expired ${humanizeDuration(nowSeconds - exp)} ago`, detail: isoFromSeconds(exp) ?? undefined };
  } else if (nbf !== undefined && nbf > nowSeconds) {
    summary = { tone: 'warning', title: `Not valid yet: becomes valid in ${humanizeDuration(nbf - nowSeconds)}`, detail: isoFromSeconds(nbf) ?? undefined };
  } else if (exp !== undefined) {
    summary = { tone: 'success', title: `Not expired: expires in ${humanizeDuration(exp - nowSeconds)}`, detail: isoFromSeconds(exp) ?? undefined };
  } else if ('exp' in claims) {
    summary = { tone: 'warning', title: 'Expiry unknown: “exp” is not a valid number' };
  } else {
    summary = { tone: 'neutral', title: 'No expiry: the token has no “exp” claim' };
  }

  const lifetime = exp !== undefined && iat !== undefined && exp > iat ? humanizeDuration(exp - iat) : undefined;
  return { rows, summary, issues, lifetime };
}
