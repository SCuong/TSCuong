export type ShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code' | 'target'> & {
  getModifierState?: (key: string) => boolean;
};

/** True for elements where a keystroke types text (inputs, contenteditable, CodeMirror). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || Boolean(target.closest('.cm-editor'));
}

/**
 * Ctrl+Alt+N (Cmd+Option+N) creates a note. On Windows AltGr is reported as
 * Ctrl+Alt and types characters such as "ń" (Polish) with the N key: those
 * keystrokes are text, not the shortcut.
 */
export function isNewNoteShortcut(event: ShortcutEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return false;
  if (event.getModifierState?.('AltGraph')) return false;
  if (event.key.toLowerCase() === 'n') return true;
  // Other layouts: the physical N key, unless it just produced a character in a text field.
  return event.code === 'KeyN' && (event.key.length !== 1 || !isTypingTarget(event.target));
}
