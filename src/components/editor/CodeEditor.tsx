import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { cn } from '@/lib/utils';
import { loadLanguage, type EditorLanguage } from './languages';

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'var(--lk-syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: 'var(--lk-syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.literal], color: 'var(--lk-syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: 'var(--lk-syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--lk-syn-function)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--lk-syn-property)' },
  { tag: [t.typeName, t.className, t.namespace, t.labelName], color: 'var(--lk-syn-type)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--lk-syn-tag)' },
  { tag: [t.attributeName], color: 'var(--lk-syn-attr)' },
  { tag: t.heading, color: 'var(--lk-syn-property)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--lk-syn-string)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--lk-syn-string)' },
  { tag: t.deleted, color: 'var(--lk-danger)' },
  { tag: t.invalid, color: 'var(--lk-syn-invalid)' },
]);

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--lk-surface-sunken)',
    color: 'var(--lk-text-primary)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--lk-accent-text)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': {
    backgroundColor: 'var(--lk-surface-sunken)',
    color: 'var(--lk-text-muted)',
    border: 'none',
    borderRight: '1px solid var(--lk-border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--lk-surface-hover)', color: 'var(--lk-text-secondary)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--lk-surface-hover) 55%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--lk-accent-text)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--lk-syn-selection) !important',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--lk-syn-match)' },
  '.cm-searchMatch': { backgroundColor: 'var(--lk-syn-match)', outline: '1px solid var(--lk-border-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--lk-syn-match-active)' },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--lk-accent-soft)',
    outline: '1px solid var(--lk-accent-line)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--lk-surface-hover)',
    border: '1px solid var(--lk-border)',
    color: 'var(--lk-text-muted)',
  },
  '.cm-placeholder': { color: 'var(--lk-text-muted)' },
  '.cm-panels': {
    backgroundColor: 'var(--lk-surface-raised)',
    color: 'var(--lk-text-primary)',
    borderColor: 'var(--lk-border)',
  },
  '.cm-panels input, .cm-panels button': { fontSize: '12.5px' },
  '.cm-textfield': {
    backgroundColor: 'var(--lk-surface-sunken)',
    border: '1px solid var(--lk-border-strong)',
    borderRadius: '6px',
    color: 'var(--lk-text-primary)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--lk-surface-hover)',
    border: '1px solid var(--lk-border-strong)',
    borderRadius: '6px',
    color: 'var(--lk-text-primary)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--lk-surface-raised)',
    border: '1px solid var(--lk-border-strong)',
    borderRadius: '8px',
    color: 'var(--lk-text-primary)',
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--lk-danger)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--lk-danger)' },
});

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  placeholder?: string;
  lineWrapping?: boolean;
  lineNumbers?: boolean;
  className?: string;
  /** Accessible name for the editor. */
  ariaLabel: string;
  extensions?: Extension[];
  autoFocus?: boolean;
  onReady?: (view: EditorView) => void;
}

/**
 * Controlled CodeMirror 6 editor themed with the app's design tokens.
 * Language support is loaded on demand.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'plain',
  readOnly = false,
  placeholder,
  lineWrapping = true,
  lineNumbers: showLineNumbers = true,
  className,
  ariaLabel,
  extensions,
  autoFocus,
  onReady,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const langCompartment = useRef(new Compartment());
  const configCompartment = useRef(new Compartment());
  const extraCompartment = useRef(new Compartment());

  const config = (): Extension[] => [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    lineWrapping ? EditorView.lineWrapping : [],
    showLineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : [],
    placeholder ? placeholderExt(placeholder) : [],
    // Keep the content in the tab order explicitly: read-only content is not contenteditable (so it
    // would not be focusable at all), and CodeMirror marks its scroller tabindex=-1, so assistive
    // checks need an explicit tabindex to see that the scroll region is keyboard-reachable.
    EditorView.contentAttributes.of(
      readOnly
        ? { 'aria-label': ariaLabel, 'aria-readonly': 'true', tabindex: '0' }
        : { 'aria-label': ariaLabel, tabindex: '0' },
    ),
  ];

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(highlightStyle),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        baseTheme,
        EditorState.tabSize.of(2),
        configCompartment.current.of(config()),
        langCompartment.current.of([]),
        extraCompartment.current.of(extensions ?? []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    if (autoFocus) v.focus();
    onReady?.(v);
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; props are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes without clobbering the cursor for local edits.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: configCompartment.current.reconfigure(config()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, lineWrapping, showLineNumbers, placeholder, ariaLabel]);

  useEffect(() => {
    view.current?.dispatch({ effects: extraCompartment.current.reconfigure(extensions ?? []) });
  }, [extensions]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((ext) => {
      if (!cancelled) view.current?.dispatch({ effects: langCompartment.current.reconfigure(ext) });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return (
    <div
      ref={host}
      className={cn(
        'min-h-0 overflow-hidden rounded-lg border border-line-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--lk-accent-soft)]',
        className,
      )}
    />
  );
}
