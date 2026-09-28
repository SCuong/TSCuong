import { describe, expect, it } from 'vitest';
import { GIT_RECIPES, RECIPE_GROUPS, searchRecipes } from './gitCommands';

describe('git recipes data', () => {
  it('has unique ids, known groups and non-empty content', () => {
    const ids = GIT_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of GIT_RECIPES) {
      expect(RECIPE_GROUPS).toContain(r.group);
      expect(r.commands.length).toBeGreaterThan(0);
      expect(r.explain.length).toBeGreaterThan(10);
    }
  });
  it('every command starts with git (optionally chained)', () => {
    for (const r of GIT_RECIPES) {
      for (const c of r.commands) expect(c.cmd, r.id).toMatch(/^git /);
    }
  });
  it('flags history-rewriting commands with a warning', () => {
    for (const r of GIT_RECIPES) {
      const risky = r.commands.some((c) => /reset --hard|--force|filter-repo|clean -f|stash clear|--amend|rebase -i/.test(c.cmd));
      if (risky) expect(r.danger, r.id).toBeTruthy();
    }
  });
});

describe('searchRecipes', () => {
  it('returns everything for an empty query', () => {
    expect(searchRecipes('  ')).toHaveLength(GIT_RECIPES.length);
  });
  it('finds common tasks by natural phrases', () => {
    expect(searchRecipes('undo last commit')[0].id).toMatch(/^undo-last-commit/);
    expect(searchRecipes('rename branch')[0].id).toBe('rename-branch');
    expect(searchRecipes('cherry')[0].id).toBe('cherry-pick');
    expect(searchRecipes('STASH').length).toBeGreaterThanOrEqual(3);
  });
  it('matches commands and requires every word', () => {
    expect(searchRecipes('--force-with-lease').map((r) => r.id)).toContain('force-push');
    expect(searchRecipes('rename xyzzy')).toEqual([]);
  });
  it('handles unicode queries without throwing', () => {
    expect(searchRecipes('tài liệu 🚀')).toEqual([]);
  });
});
