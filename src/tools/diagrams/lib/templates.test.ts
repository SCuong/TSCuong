import { describe, expect, it } from 'vitest';
import { DIAGRAM_TEMPLATES, detectDiagramKind, getTemplate } from './templates';

describe('diagram templates', () => {
  it('have unique ids and non-empty code', () => {
    const ids = DIAGRAM_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of DIAGRAM_TEMPLATES) expect(t.code.trim().length).toBeGreaterThan(10);
  });

  it('are detected as their own kind', () => {
    for (const t of DIAGRAM_TEMPLATES) expect(detectDiagramKind(t.code)).toBe(t.id);
  });

  it('all parse with the installed Mermaid version', async () => {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    for (const t of DIAGRAM_TEMPLATES) {
      await expect(mermaid.parse(t.code), t.id).resolves.toBeTruthy();
    }
  }, 60_000);

  it('getTemplate finds by id', () => {
    expect(getTemplate('pie')?.name).toBe('Pie chart');
    expect(getTemplate('nope')).toBeUndefined();
    expect(getTemplate(undefined)).toBeUndefined();
  });
});

describe('detectDiagramKind', () => {
  it('skips comments, blank lines and front matter', () => {
    expect(detectDiagramKind('\n%% comment\n  graph LR\nA-->B')).toBe('flowchart');
    expect(detectDiagramKind('---\ntitle: Hi\n---\nsequenceDiagram\nA->>B: x')).toBe('sequence');
    expect(detectDiagramKind('stateDiagram\n[*]-->A')).toBe('state');
  });
  it('returns null for unknown or empty input', () => {
    expect(detectDiagramKind('')).toBeNull();
    expect(detectDiagramKind('hello world')).toBeNull();
    expect(detectDiagramKind('%% only a comment')).toBeNull();
  });
});
