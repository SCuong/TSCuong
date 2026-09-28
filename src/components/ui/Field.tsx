import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[13px] font-medium text-fg-secondary', className)}>
      {children}
    </label>
  );
}

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  /** Render function receives the ids needed to wire up the control accessibly. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** Label + control + hint/error, with the error announced to screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('min-w-0', className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="mt-1.5 text-[12.5px] text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className, mono, ...rest }, ref) {
    return <input ref={ref} className={cn('lk-field', mono && 'font-mono text-[13px]', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  function Textarea({ className, mono = true, spellCheck = false, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        spellCheck={spellCheck}
        className={cn('lk-field', mono && 'lk-textarea', className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn('lk-field', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  className,
  description,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] size-4 shrink-0 cursor-pointer rounded accent-[var(--lk-accent)] disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-snug text-fg select-none">
        {label}
        {description && <span className="mt-0.5 block text-[12.5px] text-fg-muted">{description}</span>}
      </label>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150',
          checked ? 'border-transparent bg-accent' : 'border-line-strong bg-surface-hover',
          'disabled:opacity-50',
        )}
      >
        <span
          className={cn(
            'inline-block size-3.5 rounded-full bg-white shadow transition-transform duration-150',
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm text-fg select-none">
        {label}
      </label>
    </div>
  );
}

/** Numeric input that reports numbers (or null when empty/invalid). */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | '';
  onChange: (value: number | '') => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cn('lk-field tabular-nums', className)}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange('');
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      {...rest}
    />
  );
}
