import { collection } from '@/lib/storage/db';
import type { Note } from './notes';

/**
 * The notes collection. Every component uses this one object, so writes from the
 * list (favorites, deletes) and the editor's autosave are serialized together.
 */
export const notesStore = collection<Note>('notes');
