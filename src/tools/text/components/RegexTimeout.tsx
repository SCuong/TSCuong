import { Alert } from '@/components/ui/Alert';
import { pluralize } from '@/lib/utils';

/** Time allowed for a user's regular expression: 2 s plus 1 s per started megabyte of text. */
export function regexTimeoutMs(size: number): number {
  return 2000 + Math.ceil(size / 1_000_000) * 1000;
}

/** Explains a regular expression that was stopped for taking too long (catastrophic backtracking). */
export function RegexTimeoutAlert({ size }: { size: number }) {
  return (
    <Alert tone="warning" title={`The pattern took longer than ${pluralize(regexTimeoutMs(size) / 1000, 'second')} and was stopped`}>
      This usually means catastrophic backtracking: nested or overlapping repetition such as <code>(a+)+</code> or{' '}
      <code>(\w+\s?)*</code> can try exponentially many ways to match text that almost matches. Make the repeated parts unable to
      match the same characters, anchor the pattern, or use a more specific class.
    </Alert>
  );
}
