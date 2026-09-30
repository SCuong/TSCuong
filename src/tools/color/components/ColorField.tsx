import { useId, useState } from 'react';
import { CopyButton } from '@/components/ui/Actions';
import { cn } from '@/lib/utils';

/**
 * A text field that shows a derived value but lets the user type freely.
 * While focused the draft is kept; every valid draft is committed live.
 */
export function ColorField({
  label,
  hint,
  value,
  onCommit,
  validate,
}: {
  label: string;
  hint?: string;
  value: string;
  /** Called with the text when it parses. */
  onCommit: (text: string) => void;
  /** Returns an error message, or null when the text is valid. */
  validate: (text: string) => string | null;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? value;

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-fg-secondary">
          {label}
        </label>
        {hint && <span className="truncate text-[11.5px] text-fg-muted">{hint}</span>}
      </div>
      <div className="flex items-center gap-1">
        <input
          id={id}
          value={shown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onFocus={() => setDraft(value)}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const problem = validate(text);
            setError(problem);
            if (!problem) onCommit(text);
          }}
          onBlur={() => {
            setDraft(null);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value);
              setError(null);
            }
          }}
          className={cn('lk-field font-mono text-[13px]')}
        />
        <CopyButton value={value} iconOnly label={`Copy ${label}`} />
      </div>
      {/* Always present so screen readers announce errors politely as they appear while typing. */}
      <p id={`${id}-err`} aria-live="polite" className={cn('text-[12px] text-danger', error && 'mt-1')}>
        {error}
      </p>
    </div>
  );
}
