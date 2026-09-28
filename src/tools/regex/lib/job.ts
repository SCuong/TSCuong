import { describeRegexError } from './errors';
import { findMatches, type MatchSummary } from './match';
import { expandReplacement } from './replace';

export interface RegexJob {
  pattern: string;
  flags: string;
  text: string;
  /** When set, also compute the replaced text and per-match replacements. */
  replacement: string | null;
  maxDetails?: number;
  maxCount?: number;
}

export type RegexJobResult =
  | {
      ok: true;
      summary: MatchSummary;
      /** Whole text after `String.prototype.replace` (only in replace mode). */
      replaced: string | null;
      /** Replacement for each detailed match (only in replace mode). */
      replacements: string[] | null;
      elapsedMs: number;
    }
  | { ok: false; error: string };

/** The work done inside the Web Worker (pure, so it is unit-testable). */
export function runRegexJob(job: RegexJob): RegexJobResult {
  const started = performance.now();
  try {
    const summary = findMatches(job.pattern, job.flags, job.text, { maxDetails: job.maxDetails, maxCount: job.maxCount });
    let replaced: string | null = null;
    let replacements: string[] | null = null;
    if (job.replacement !== null) {
      replaced = job.text.replace(new RegExp(job.pattern, job.flags), job.replacement);
      const hasNamedGroups = summary.matches.some((m) => m.groups.some((g) => g.name));
      replacements = summary.matches.map((match) =>
        expandReplacement(job.replacement!, { input: job.text, match, hasNamedGroups }),
      );
    }
    return { ok: true, summary, replaced, replacements, elapsedMs: performance.now() - started };
  } catch (error) {
    return { ok: false, error: describeRegexError(error, job.flags) };
  }
}
