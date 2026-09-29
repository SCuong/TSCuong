import { forwardRef, useCallback, useRef, type ClipboardEvent, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { segments, variableStatus, type Scope } from '../lib/vars';

export interface VarInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  scope: Scope;
  /** Render in monospace (URL bar, values). */
  mono?: boolean;
  onEnter?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPasteText?: (text: string, e: ClipboardEvent<HTMLInputElement>) => void;
  /** Use the compact table-cell style instead of the standard field. */
  cell?: boolean;
}

/**
 * A text input that highlights `{{variables}}`: resolved ones in the accent
 * color, unknown ones in red. The highlighting is a mirror layer behind a
 * transparent-text input, so editing, selection and IME work natively.
 */
export const VarInput = forwardRef<HTMLInputElement, VarInputProps>(function VarInput(
  { value, onChange, scope, mono, onEnter, onPasteText, cell, className, onKeyDown, onScroll, title, ...rest },
  forwarded,
) {
  const mirror = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const hasVars = value.includes('{{');

  const sync = useCallback(() => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft;
  }, []);

  const missing = hasVars
    ? segments(value)
        .filter((s) => s.type === 'var' && variableStatus(s.name, scope) === 'missing')
        .map((s) => (s.type === 'var' ? s.name : ''))
    : [];

  const base = cell
    ? 'h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-[13px] leading-8 outline-none hover:border-line focus:border-accent focus:bg-surface-sunken'
    : 'lk-field';

  return (
    <div className={cn('relative min-w-0', className)}>
      {hasVars && (
        <div
          ref={mirror}
          aria-hidden
          className={cn(
            base,
            'pointer-events-none absolute inset-0 overflow-hidden border-transparent! whitespace-pre text-fg shadow-none!',
            mono && 'font-mono text-[13px]',
          )}
        >
          {segments(value).map((s, i) => {
            if (s.type !== 'var') return <span key={i}>{s.text}</span>;
            const status = variableStatus(s.name, scope);
            return (
              <span
                key={i}
                className={cn(
                  'rounded-[3px]',
                  status === 'missing'
                    ? 'bg-danger-soft text-danger underline decoration-danger decoration-wavy underline-offset-2'
                    : 'bg-accent-soft text-accent-text',
                )}
              >
                {s.text}
              </span>
            );
          })}
        </div>
      )}
      <input
        {...rest}
        ref={(el) => {
          input.current = el;
          if (typeof forwarded === 'function') forwarded(el);
          else if (forwarded) forwarded.current = el;
        }}
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        title={title ?? (missing.length ? `Unknown variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}` : undefined)}
        aria-invalid={missing.length ? true : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(sync);
        }}
        onScroll={(e) => {
          sync();
          onScroll?.(e);
        }}
        onSelect={sync}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter && !e.nativeEvent.isComposing) onEnter(e);
          onKeyDown?.(e);
          requestAnimationFrame(sync);
        }}
        onPaste={
          onPasteText
            ? (e) => {
                const text = e.clipboardData.getData('text/plain');
                if (text) onPasteText(text, e);
              }
            : undefined
        }
        className={cn(
          base,
          'relative',
          mono && 'font-mono text-[13px]',
          hasVars && 'bg-transparent! text-transparent caret-fg selection:bg-[var(--lk-syn-selection)] selection:text-fg',
          cell && missing.length > 0 && 'border-danger/50',
        )}
      />
    </div>
  );
});
