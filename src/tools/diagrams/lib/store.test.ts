import { describe, expect, it } from 'vitest';
import { collection } from '@/lib/storage/db';
import { describeMermaidError } from './diagrams';
import { AutosaveSession, patchRecord, removeRecord } from './store';

interface Doc {
  id: string;
  name: string;
  code: string;
  favorite?: boolean;
  updatedAt: number;
}

function setup(id: string, code = 'v0') {
  const coll = collection<Doc>('diagrams');
  const initial: Doc = { id, name: 'D', code, updatedAt: 10 };
  let draft = code;
  const conflicts: Doc[] = [];
  const session = new AutosaveSession<Doc, 'code'>({
    coll,
    initial,
    read: () => ({ code: draft }),
    conflictField: 'code',
    onConflict: async (theirs) => {
      conflicts.push(theirs);
    },
  });
  return {
    coll,
    initial,
    session,
    conflicts,
    type(value: string) {
      draft = value;
      session.markDirty(['code']);
    },
  };
}

describe('AutosaveSession', () => {
  it('saves the latest text, even when typing continues during a save', async () => {
    const t = setup('s1');
    await t.coll.put(t.initial);
    t.type('v1');
    const saving = t.session.save();
    t.type('v2');
    await saving;
    await t.session.save();
    expect((await t.coll.get('s1'))?.code).toBe('v2');
    expect(t.session.pending).toBe(false);
  });

  it('saveNow issues the write without awaiting a read (page unload)', async () => {
    const t = setup('s2');
    await t.coll.put(t.initial);
    t.type('last words');
    const write = t.session.saveNow();
    expect(write).not.toBeNull();
    await write;
    expect((await t.coll.get('s2'))?.code).toBe('last words');
    expect(t.session.saveNow()).toBeNull();
  });

  it('keeps the other tab’s version when both changed the text', async () => {
    const t = setup('s3');
    await t.coll.put(t.initial);
    await t.coll.put({ ...t.initial, code: 'theirs', updatedAt: 20 });
    t.type('mine');
    await t.session.save();
    expect(t.conflicts.map((c) => c.code)).toEqual(['theirs']);
    expect((await t.coll.get('s3'))?.code).toBe('mine');
  });

  it('adopts newer versions from another tab when there are no local edits', () => {
    const t = setup('s4');
    expect(t.session.observe({ ...t.initial, code: 'newer', updatedAt: 11 })).toEqual({ code: 'newer' });
    expect(t.session.observe({ ...t.initial, code: 'older', updatedAt: 5 })).toBeNull();
    t.type('local');
    expect(t.session.observe({ ...t.initial, code: 'even newer', updatedAt: 12 })).toBeNull();
  });

  it('does not bring back a deleted record', async () => {
    const t = setup('s5');
    await t.coll.put(t.initial);
    t.type('late edit');
    await removeRecord(t.coll, 's5');
    expect(await t.session.save()).toBeNull();
    expect(await t.coll.get('s5')).toBeUndefined();
  });

  it('patchRecord can leave updatedAt alone (starring is not an edit)', async () => {
    const coll = collection<Doc>('diagrams');
    await coll.put({ id: 'p9', name: 'A', code: 'x', updatedAt: 7 });
    const saved = await patchRecord(coll, 'p9', { favorite: true }, Date.now, { touch: false });
    expect(saved).toMatchObject({ favorite: true, updatedAt: 7 });
    await coll.remove('p9');
  });
});

describe('describeMermaidError positions', () => {
  it('reports the end of the text for Jison EOF tokens and keeps the column', () => {
    const error = Object.assign(new Error("Parse error on line 3:\n...\n---^\nExpecting 'SQE', 'PE', got '1'"), {
      hash: { loc: { first_line: 3, first_column: 10 }, token: 1 },
    });
    const err = describeMermaidError(error, 'flowchart TD\n  A --> B\n  B --> C[unclosed');
    expect(err).toMatchObject({ line: 3, column: 11 });
    expect(err.message).toMatch(/^The diagram ends unexpectedly\. Expected one of: "\]", "\)"\./);
  });
  it('reads the column from Langium messages', () => {
    const err = describeMermaidError(new Error('Parsing failed:  Parse error on line 3, column 7: Expecting token of type \':\' but found `2`.'), 'pie\n "a" : 1\n "b" 2');
    expect(err).toMatchObject({ line: 3, column: 7 });
  });
  it('finds the line of an invalid Gantt date and of an unknown branch', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  task : a, 2024-13-45, 3d';
    const date = describeMermaidError(new Error('Invalid date:2024-13-45'), src);
    expect(date).toMatchObject({ line: 3, column: 13 });
    expect(date.message).toMatch(/^Invalid date "2024-13-45"\./);
    const merge = describeMermaidError(Object.assign(new Error('Branch to be merged (nothere) does not exist'), { hash: { token: 'merge nothere' } }), 'gitGraph\n  commit\n  merge nothere');
    expect(merge.line).toBe(3);
  });
});
