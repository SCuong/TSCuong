import { FLAGS, isFlagSupported, toggleFlag } from '../lib/flags';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Toggle buttons for the regex flags; unsupported flags (e.g. `v` in older browsers) are disabled. */
export function FlagToggles({ flags, onChange }: { flags: string; onChange: (flags: string) => void }) {
  return (
    <div role="group" aria-label={t('Flags')} className="flex flex-wrap gap-1.5">
      {FLAGS.map(({ flag, name, description }) => {
        const supported = isFlagSupported(flag);
        const on = flags.includes(flag);
        return (
          <button
            key={flag}
            type="button"
            aria-pressed={on}
            disabled={!supported}
            title={supported ? `${flag}: ${description}` : t('The {flag} flag is not supported in this browser', { flag })}
            onClick={() => onChange(toggleFlag(flags, flag))}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors duration-100',
              'disabled:cursor-not-allowed disabled:opacity-45',
              on
                ? 'border-accent-line bg-accent-soft text-accent-text'
                : 'border-line bg-surface-sunken text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            <span className="font-mono font-semibold">{flag}</span>
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
