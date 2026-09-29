import type { SchemaDraft } from '@cfworker/json-schema';

export type DraftChoice = 'auto' | SchemaDraft;

export const DRAFT_LABELS: Record<SchemaDraft, string> = {
  '4': 'draft-04',
  '7': 'draft-07',
  '2019-09': '2019-09',
  '2020-12': '2020-12',
};

export const DEFAULT_DRAFT: SchemaDraft = '2020-12';

export interface DeclaredDraft {
  /** The draft the engine will use for this declaration. */
  draft: SchemaDraft;
  /** Human name of what the schema declared (e.g. "draft-06"). */
  name: string;
  /** Set when the declared draft is approximated by another one. */
  note?: string;
}

/** Recognizes the standard `$schema` meta-schema URIs. Returns null for anything else. */
export function draftFromUri(uri: string): DeclaredDraft | null {
  const u = uri.trim().toLowerCase();
  if (/json-schema\.org\/draft-03\/schema/.test(u)) {
    return { draft: '4', name: 'draft-03', note: 'Draft 3 is not supported; it is validated with draft-04 rules, which differ for "required" and "type".' };
  }
  if (/json-schema\.org\/draft-04\/schema/.test(u)) return { draft: '4', name: 'draft-04' };
  if (/json-schema\.org\/draft-06\/schema/.test(u)) {
    return { draft: '7', name: 'draft-06', note: 'Draft 6 is validated with draft-07 rules (draft 7 only adds keywords).' };
  }
  if (/json-schema\.org\/draft-07\/schema/.test(u)) return { draft: '7', name: 'draft-07' };
  if (/json-schema\.org\/draft\/2019-09\/schema/.test(u)) return { draft: '2019-09', name: '2019-09' };
  if (/json-schema\.org\/draft\/2020-12\/schema/.test(u)) return { draft: '2020-12', name: '2020-12' };
  if (/json-schema\.org\/draft\/next\/schema/.test(u)) {
    return { draft: '2020-12', name: 'next', note: 'The "next" draft is validated with 2020-12 rules.' };
  }
  return null;
}

export interface DraftResolution {
  draft: SchemaDraft;
  /** Where the draft came from. */
  source: 'selected' | 'declared' | 'default';
  /** Warnings about the choice (unknown $schema, mismatches, approximations). */
  notes: string[];
}

export function resolveDraft(schema: unknown, choice: DraftChoice): DraftResolution {
  const declaredUri =
    schema && typeof schema === 'object' && !Array.isArray(schema) && typeof (schema as Record<string, unknown>).$schema === 'string'
      ? ((schema as Record<string, unknown>).$schema as string)
      : null;
  const declared = declaredUri ? draftFromUri(declaredUri) : null;
  const notes: string[] = [];

  if (choice !== 'auto') {
    if (declared && declared.draft !== choice) {
      notes.push(`The schema declares ${declared.name} in "$schema", but ${DRAFT_LABELS[choice]} rules are selected.`);
    }
    return { draft: choice, source: 'selected', notes };
  }
  if (declared) {
    if (declared.note) notes.push(declared.note);
    return { draft: declared.draft, source: 'declared', notes };
  }
  if (declaredUri) {
    notes.push(`Unrecognized "$schema" ${JSON.stringify(declaredUri)}; validating with ${DRAFT_LABELS[DEFAULT_DRAFT]} rules.`);
  }
  return { draft: DEFAULT_DRAFT, source: 'default', notes };
}
