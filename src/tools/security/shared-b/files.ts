/** Reading key/certificate files that may be PEM text or binary DER. */

import { bytesToBase64 } from '../shared-a/bytes';
import { classifyDer, PEM_LABEL_FOR } from './keyinfo';
import { encodePem } from './pem';

export const MAX_KEY_FILE_BYTES = 5 * 1024 * 1024;

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let control = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control <= sample.length * 0.02;
}

/**
 * Converts file bytes to text for the inspectors: PEM/JSON/text files are returned as-is,
 * binary DER is re-encoded as PEM with a label guessed from its structure.
 */
export function bytesToKeyText(bytes: Uint8Array): { text: string; converted: boolean } {
  if (bytes.length === 0) return { text: '', converted: false };
  if (bytes[0] === 0x30 && !looksLikeText(bytes)) {
    const kind = classifyDer(bytes);
    const label = kind === 'unknown' ? 'UNKNOWN DER DATA' : PEM_LABEL_FOR[kind];
    return { text: encodePem(label, bytes), converted: true };
  }
  if (!looksLikeText(bytes)) {
    // Unknown binary: show it as Base64 so the parser can explain what is wrong.
    return { text: bytesToBase64(bytes), converted: true };
  }
  return { text: new TextDecoder('utf-8').decode(bytes), converted: false };
}

export async function readKeyFile(file: File): Promise<{ text: string; converted: boolean }> {
  if (file.size > MAX_KEY_FILE_BYTES) {
    throw new Error(`That file is ${Math.round(file.size / 1024 / 1024)} MB. Key and certificate files are at most a few KB; is it the right file?`);
  }
  return bytesToKeyText(new Uint8Array(await file.arrayBuffer()));
}
