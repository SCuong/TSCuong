import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { ArrowDownUp, ChevronDown, Crosshair } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Field';
import { Segmented, type SegmentOption } from '@/components/ui/Segmented';
import { cn, formatBytes, pluralize } from '@/lib/utils';
import { problemMarkers, revealPosition, type EditorProblem } from '@/tools/json/shared/errorMarkers';
import { countLines, utf8Bytes, type ConvertError } from '../lib/common';
import { t } from '@/lib/i18n';

/** Label above a toolbar control. */
export function Option({ label, htmlFor, children, className }: { label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** Two-way direction selector plus a Swap button that feeds the output back in. */
export function DirectionSwitch<T extends string>({
  value,
  onChange,
  options,
  onSwap,
  canSwap,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  onSwap: () => void;
  canSwap: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <Option label={t('Direction')}>
        <Segmented label={t('Direction')} value={value} onChange={onChange} options={options} />
      </Option>
      <Button icon={ArrowDownUp} onClick={onSwap} disabled={!canSwap} title={t('Use the output as the new input and switch direction')} className="h-8">
        {t('Swap')}
      </Button>
    </div>
  );
}

/** Keeps the input editor's view so errors can be revealed. */
export function useEditorView() {
  const ref = useRef<EditorView | null>(null);
  const onReady = (view: EditorView) => {
    ref.current = view;
  };
  const reveal = (line?: number, column?: number) => {
    if (line !== undefined) revealPosition(ref.current, line, column ?? 1);
  };
  return { onReady, reveal };
}

const NO_PROBLEMS: EditorProblem[] = [];

/**
 * CodeMirror extension that marks the error line (and character) in the input, plus
 * optional extra problems. Pass a memoized `extra` array so the editor is not reconfigured on every render.
 */
export function useProblemMarkers(error: ConvertError | null | undefined, extra: EditorProblem[] = NO_PROBLEMS) {
  return useMemo(() => {
    const problems: EditorProblem[] = [...extra];
    if (error?.line !== undefined) problems.push({ line: error.line, column: error.column, length: 1, message: error.message });
    return [problemMarkers(problems)];
  }, [error, extra]);
}

/** Error box with the position and a button that jumps to it. */
export function ErrorPanel({ title, error, onReveal }: { title: string; error: ConvertError | null | undefined; onReveal?: () => void }) {
  if (!error) return null;
  const hasPosition = error.line !== undefined;
  return (
    <Alert
      tone="danger"
      title={title}
      action={
        hasPosition && onReveal ? (
          <Button size="sm" icon={Crosshair} onClick={onReveal}>
            {t('Go to error')}
          </Button>
        ) : undefined
      }
    >
      {error.message}
      {hasPosition && (
        <span className="mt-0.5 block font-mono text-[12.5px] text-fg-secondary">
          {error.column !== undefined
            ? t('Line {line}, column {column}', { line: error.line, column: error.column })
            : t('Line {line}', { line: error.line })}
        </span>
      )}
    </Alert>
  );
}

const VISIBLE_NOTES = 4;

/** Warnings about what a conversion changed or could not keep. */
export function NotesPanel({ notes, title = t('Conversion notes') }: { notes: string[]; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!notes.length) return null;
  const shown = expanded ? notes : notes.slice(0, VISIBLE_NOTES);
  return (
    <Alert tone="warning" title={title}>
      <ul className="list-disc space-y-0.5 pl-4">
        {shown.map((note, i) => (
          <li key={i} className="break-words">
            {note}
          </li>
        ))}
      </ul>
      {notes.length > VISIBLE_NOTES && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-text hover:underline"
        >
          <ChevronDown size={14} aria-hidden className={cn('transition-transform', expanded && 'rotate-180')} />
          {expanded ? t('Show fewer') : t('Show {count} more', { count: notes.length - VISIBLE_NOTES })}
        </button>
      )}
    </Alert>
  );
}

/** A suggestion to switch direction when the input looks like the other format. */
export function DirectionHint({ children, actionLabel, onAction }: { children: ReactNode; actionLabel: string; onAction: () => void }) {
  return (
    <Alert
      tone="info"
      action={
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      }
    >
      {children}
    </Alert>
  );
}

/** "1.2 KB · 40 lines" footer content. */
export function TextStats({ text, extra }: { text: string; extra?: ReactNode }) {
  if (!text) return null;
  return (
    <>
      <span>{formatBytes(utf8Bytes(text))}</span>
      <span>{pluralize(countLines(text), t('line'), t('lines'))}</span>
      {extra}
    </>
  );
}

/** A disclosure button for secondary toolbar options. */
export function MoreOptionsToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <Button variant="ghost" size="sm" iconRight={ChevronDown} aria-expanded={open} aria-controls={controls} onClick={onToggle} className={cn('h-8', open && '[&>svg]:rotate-180')}>
      {open ? t('Fewer options') : t('More options')}
    </Button>
  );
}
