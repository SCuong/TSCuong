import { describe, expect, it } from 'vitest';
import { GITIGNORE_TEMPLATES, TEMPLATE_GROUPS, getTemplate, mergeGitignore, searchTemplates } from './gitignore';

describe('gitignore templates', () => {
  it('have unique ids and valid groups', () => {
    const ids = GITIGNORE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tpl of GITIGNORE_TEMPLATES) {
      expect(TEMPLATE_GROUPS).toContain(tpl.group);
      expect(tpl.content.trim().length).toBeGreaterThan(0);
    }
  });
  it('covers the required stacks', () => {
    for (const id of ['node', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'dotnet', 'unity', 'macos', 'windows', 'linux', 'jetbrains', 'vscode', 'vim', 'android', 'xcode', 'terraform', 'docker', 'hugo', 'jekyll', 'laravel', 'django', 'nextjs', 'vite']) {
      expect(getTemplate(id), id).toBeDefined();
    }
  });
  it('contain no duplicate patterns within one template and no trailing whitespace', () => {
    for (const tpl of GITIGNORE_TEMPLATES) {
      const patterns = tpl.content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      expect(new Set(patterns).size, tpl.id).toBe(patterns.length);
      for (const line of tpl.content.split('\n')) expect(line, tpl.id).toBe(line.trimEnd());
    }
  });
});

describe('searchTemplates', () => {
  it('matches names, ids and keywords case-insensitively', () => {
    expect(searchTemplates('').length).toBe(GITIGNORE_TEMPLATES.length);
    expect(searchTemplates('NODE').map((t) => t.id)).toContain('node');
    expect(searchTemplates('intellij').map((t) => t.id)).toEqual(['jetbrains']);
    expect(searchTemplates('c#').map((t) => t.id)).toContain('dotnet');
    expect(searchTemplates('zzzz')).toEqual([]);
  });
});

describe('mergeGitignore', () => {
  it('returns empty text for nothing selected', () => {
    expect(mergeGitignore([])).toEqual({ text: '', duplicates: 0, patterns: 0 });
  });

  it('adds section headers and ends with a newline', () => {
    const r = mergeGitignore(['macos']);
    expect(r.text.startsWith('# ===== macOS =====\n.DS_Store\n')).toBe(true);
    expect(r.text.endsWith('\n')).toBe(true);
    expect(mergeGitignore(['macos'], '', { headers: false }).text.startsWith('.DS_Store')).toBe(true);
  });

  it('removes patterns repeated across templates', () => {
    const r = mergeGitignore(['node', 'vite']);
    const lines = r.text.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(new Set(lines).size).toBe(lines.length);
    expect(r.duplicates).toBeGreaterThan(0);
    // dist/ and coverage/ come from Node, so the Vite section only keeps its own patterns
    expect(r.text).toMatch(/# ===== Vite =====\ndist-ssr\/\n\*\.local\n\.vite\//);
  });

  it('drops a section entirely when all of its patterns are duplicates', () => {
    const r = mergeGitignore(['c', 'cpp', 'c']);
    expect(r.text.match(/===== C =====/g)).toHaveLength(1);
    const sub = mergeGitignore(['linux', 'vim']);
    expect(sub.text).not.toMatch(/\n\*~\n[\s\S]*\n\*~\n/);
  });

  it('drops comment headings whose patterns were all duplicates', () => {
    const r = mergeGitignore(['c', 'cpp']);
    const cpp = r.text.split('# ===== C++ =====')[1];
    expect(cpp).not.toContain('# Libraries');
    expect(cpp).toContain('# CMake');
  });

  it('keeps custom lines and their comments, de-duplicated', () => {
    const r = mergeGitignore(['node'], '# secrets\nsecret.json\nnode_modules/\n\n  \n*.pem   \r\n');
    expect(r.text).toMatch(/# ===== Custom =====\n# secrets\nsecret\.json\n\n\*\.pem\n$/);
  });

  it('handles unicode custom patterns and unknown ids', () => {
    const r = mergeGitignore(['nope'], 'tài-liệu/\n📁/');
    expect(r.text).toBe('# ===== Custom =====\ntài-liệu/\n📁/\n');
    expect(r.patterns).toBe(2);
  });

  it('merges every template quickly without duplicates', () => {
    const r = mergeGitignore(GITIGNORE_TEMPLATES.map((t) => t.id));
    const lines = r.text.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(new Set(lines).size).toBe(lines.length);
    expect(r.patterns).toBe(lines.length);
  });
});
