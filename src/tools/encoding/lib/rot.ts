/** Letter rotation ciphers. These are obfuscation, not encryption. */

export function caesar(text: string, shift: number, rotateDigits = false): string {
  const s = ((shift % 26) + 26) % 26;
  const d = ((shift % 10) + 10) % 10;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 65 && c <= 90) out += String.fromCharCode(((c - 65 + s) % 26) + 65);
    else if (c >= 97 && c <= 122) out += String.fromCharCode(((c - 97 + s) % 26) + 97);
    else if (rotateDigits && c >= 48 && c <= 57) out += String.fromCharCode(((c - 48 + (Math.abs(shift) === 13 ? 5 : d)) % 10) + 48);
    else out += text[i];
  }
  return out;
}

export function rot13(text: string): string {
  return caesar(text, 13);
}

/** ROT18 = ROT13 on letters + ROT5 on digits. */
export function rot18(text: string): string {
  return caesar(text, 13, true);
}

/** ROT47 rotates all printable ASCII characters from "!" (33) to "~" (126). */
export function rot47(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c >= 33 && c <= 126 ? String.fromCharCode(33 + ((c - 33 + 47) % 94)) : text[i];
  }
  return out;
}

/** All 25 Caesar shifts, useful for brute-forcing an unknown shift. */
export function allShifts(text: string): Array<{ shift: number; text: string }> {
  return Array.from({ length: 25 }, (_, i) => ({ shift: i + 1, text: caesar(text, i + 1) }));
}
