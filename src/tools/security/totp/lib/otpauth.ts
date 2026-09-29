/** otpauth:// URIs (Google Authenticator "Key Uri Format"). */

import { decodeBase32 } from './base32';
import type { OtpAlgorithm } from './otp';

export interface OtpauthData {
  type: 'totp' | 'hotp';
  issuer: string;
  account: string;
  /** Base32 secret, upper case without padding. */
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter?: number;
}

const URI_ALG: Record<OtpAlgorithm, string> = { 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-512': 'SHA512' };
const FROM_URI_ALG: Record<string, OtpAlgorithm> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export function buildOtpauthUri(data: OtpauthData): string {
  const issuer = data.issuer.trim();
  const account = data.account.trim() || 'user';
  const label = issuer ? `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` : encodeURIComponent(account);
  const params = [`secret=${data.secret}`];
  if (issuer) params.push(`issuer=${encodeURIComponent(issuer)}`);
  params.push(`algorithm=${URI_ALG[data.algorithm]}`, `digits=${data.digits}`);
  if (data.type === 'totp') params.push(`period=${data.period}`);
  else params.push(`counter=${data.counter ?? 0}`);
  return `otpauth://${data.type}/${label}?${params.join('&')}`;
}

export type OtpauthResult = { ok: true; value: OtpauthData } | { ok: false; error: string };

export function parseOtpauthUri(input: string): OtpauthResult {
  const text = input.trim();
  if (!/^otpauth:\/\//i.test(text)) return { ok: false, error: 'An authenticator URI starts with otpauth://.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: 'This otpauth:// URI is malformed.' };
  }
  const type = url.hostname.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') return { ok: false, error: `Unsupported OTP type “${type || '(none)'}”; expected totp or hotp.` };
  let label: string;
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return { ok: false, error: 'The label of this URI is not correctly percent-encoded.' };
  }
  const colon = label.indexOf(':');
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : '';
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const params = url.searchParams;
  const secretParam = params.get('secret');
  if (!secretParam) return { ok: false, error: 'The URI has no secret parameter.' };
  const secret = decodeBase32(secretParam);
  if (!secret.ok) return { ok: false, error: `The secret parameter is invalid: ${secret.error}` };
  const algParam = (params.get('algorithm') ?? 'SHA1').toUpperCase().replace('-', '');
  const algorithm = FROM_URI_ALG[algParam];
  if (!algorithm) return { ok: false, error: `Unsupported algorithm “${params.get('algorithm')}”; expected SHA1, SHA256 or SHA512.` };
  const digits = Number(params.get('digits') ?? 6);
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) return { ok: false, error: 'digits must be 6, 7 or 8.' };
  const period = Number(params.get('period') ?? 30);
  if (!Number.isInteger(period) || period < 1 || period > 3600) return { ok: false, error: 'period must be a whole number of seconds.' };
  const counterParam = params.get('counter');
  const counter = counterParam === null ? undefined : Number(counterParam);
  if (type === 'hotp' && (counter === undefined || !Number.isInteger(counter) || counter < 0)) {
    return { ok: false, error: 'An hotp URI needs a counter parameter.' };
  }
  return {
    ok: true,
    value: { type, issuer: params.get('issuer')?.trim() || labelIssuer, account, secret: secret.normalized, algorithm, digits, period, counter },
  };
}
