import { describe, expect, it } from 'vitest';
import { COMMON_PATTERNS, PATTERN_CATEGORIES, patternSampleText, patternTesterFlags } from './patterns';
import { CHEAT_SHEET } from './cheatsheet';
import { findMatches } from './match';
import { explainPattern } from './explain';

describe('COMMON_PATTERNS', () => {
  it('has unique ids and known categories', () => {
    const ids = COMMON_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of COMMON_PATTERNS) expect(PATTERN_CATEGORIES).toContain(p.category);
  });

  for (const p of COMMON_PATTERNS) {
    describe(p.name, () => {
      it('compiles', () => {
        expect(() => new RegExp(p.pattern, p.flags)).not.toThrow();
      });

      if (p.kind === 'validate') {
        it('accepts every positive example and rejects every negative one', () => {
          const re = new RegExp(p.pattern, p.flags);
          for (const s of p.examples!.match) expect(re.test(s), `${p.id} should match ${JSON.stringify(s)}`).toBe(true);
          for (const s of p.examples!.noMatch) expect(re.test(s), `${p.id} should reject ${JSON.stringify(s)}`).toBe(false);
        });

        it('matches exactly the positive examples when loaded into the tester (one per line)', () => {
          const found = findMatches(p.pattern, patternTesterFlags(p), patternSampleText(p)).matches.map((m) => m.text);
          expect(found).toEqual(p.examples!.match);
        });
      } else {
        it('finds exactly the expected matches in its sample', () => {
          const found = findMatches(p.pattern, p.flags, p.sample!).matches.map((m) => m.text);
          expect(found).toEqual(p.expected);
        });
      }

      it('can be explained', () => {
        expect(explainPattern(p.pattern, p.flags).nodes.length).toBeGreaterThan(0);
      });
    });
  }
});

describe('CHEAT_SHEET', () => {
  it('contains only valid example patterns', () => {
    for (const section of CHEAT_SHEET) {
      for (const row of section.rows) {
        const pattern = row.example ?? row.token;
        expect(() => new RegExp(pattern, row.flags ?? ''), pattern).not.toThrow();
      }
    }
  });
});
