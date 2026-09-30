import { Languages } from 'lucide-react';
import { getLocale, LOCALES, setLocale, t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Interface language, each option named in its own language. Choosing one reloads the page
 * (see `setLocale`), so these are plain toggle buttons rather than a radio group: arrow keys
 * must not switch the language by accident.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const current = getLocale();
  return (
    <div
      role="group"
      aria-label={t('Language')}
      className={cn('inline-flex max-w-full items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5', className)}
    >
      {LOCALES.map((option) => {
        const selected = option.id === current;
        return (
          <button
            key={option.id}
            type="button"
            lang={option.id}
            aria-pressed={selected}
            onClick={() => setLocale(option.id)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-100',
              selected ? 'bg-surface-raised text-fg shadow-card ring-1 ring-line-strong' : 'text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Header shortcut: one button that names the other language. */
export function LanguageToggle({ className }: { className?: string }) {
  const other = LOCALES.find((option) => option.id !== getLocale()) ?? LOCALES[0];
  return (
    <button
      type="button"
      onClick={() => setLocale(other.id)}
      title={t('Change language')}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
        className,
      )}
    >
      <Languages size={16} aria-hidden />
      <span lang={other.id}>{other.label}</span>
    </button>
  );
}
