/**
 * Tools suggested in the command palette before the user has any history.
 * Ids are validated by src/tools/registry/registry.test.ts, so a renamed or
 * removed tool fails the test instead of silently shrinking the list.
 */
export const PALETTE_SUGGESTED_TOOL_IDS = [
  'json-formatter',
  'pdf-merge',
  'image-compress',
  'regex-tester',
  'base64-text',
  'text-diff',
] as const;
