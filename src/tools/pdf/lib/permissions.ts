/** PDF permission flags (the /P entry of an encrypted file), as reported by pdf.js. */
export const PERMISSION_LABELS: Record<number, string> = {
  4: 'Print',
  8: 'Modify contents',
  16: 'Copy text and images',
  32: 'Add or modify annotations',
  256: 'Fill form fields',
  512: 'Extract for accessibility',
  1024: 'Assemble (insert, rotate, delete pages)',
  2048: 'High-quality print',
};

/**
 * Normalize `PDFDocumentProxy.getPermissions()`: pdf.js 6 returns a Set of flags (older
 * versions an array); null means the file has no permission restrictions.
 */
export function permissionList(permissions: unknown): number[] | null {
  if (!(permissions instanceof Set) && !Array.isArray(permissions)) return null;
  return [...(permissions as Iterable<unknown>)].filter((p): p is number => typeof p === 'number');
}

/** "Print, Copy text and images" in a stable order, or "Nothing" when every action is restricted. */
export function describePermissions(flags: readonly number[]): string {
  return (
    Object.entries(PERMISSION_LABELS)
      .filter(([flag]) => flags.includes(Number(flag)))
      .map(([, label]) => label)
      .join(', ') || 'Nothing'
  );
}
