import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast hover:bg-accent-hover border border-transparent shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
  secondary:
    'bg-surface-raised text-fg border border-line-strong hover:bg-surface-hover hover:border-line-strong shadow-card',
  subtle: 'bg-surface-hover text-fg border border-transparent hover:bg-line',
  ghost: 'bg-transparent text-fg-secondary border border-transparent hover:bg-surface-hover hover:text-fg',
  danger: 'bg-danger-solid text-white border border-transparent hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, disabled, type, ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,filter] duration-100',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={iconSize} className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden strokeWidth={2} />
      )}
      {children}
      {IconRight && <IconRight size={iconSize} aria-hidden strokeWidth={2} />}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', variant = 'ghost', active, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-100',
        'disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'size-7' : 'size-9',
        variant === 'secondary'
          ? 'border border-line-strong bg-surface-raised text-fg-secondary hover:bg-surface-hover hover:text-fg'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        active && 'text-accent-text',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 15 : 17} aria-hidden strokeWidth={2} />
    </button>
  );
});
