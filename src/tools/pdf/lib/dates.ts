const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string → value for <input type="datetime-local"> in local time ('' when empty/invalid). */
export function isoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** <input type="datetime-local"> value (local time) → ISO string ('' when empty/invalid). */
export function localInputToIso(value: string): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
