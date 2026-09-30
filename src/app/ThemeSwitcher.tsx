import { Monitor, Moon, Sun } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { setThemePreference, useTheme, type ThemePreference } from '@/lib/theme';
import { t } from '@/lib/i18n';

export function ThemeSwitcher({ withLabels = false, className }: { withLabels?: boolean; className?: string }) {
  const { preference } = useTheme();
  return (
    <Segmented<ThemePreference>
      label={t('Color theme')}
      size="sm"
      className={className}
      value={preference}
      onChange={setThemePreference}
      options={[
        { value: 'light', label: withLabels ? t('Light') : <span className="sr-only">{t('Light theme')}</span>, icon: Sun, title: t('Light theme') },
        { value: 'dark', label: withLabels ? t('Dark') : <span className="sr-only">{t('Dark theme')}</span>, icon: Moon, title: t('Dark theme') },
        {
          value: 'system',
          label: withLabels ? t('System') : <span className="sr-only">{t('System theme')}</span>,
          icon: Monitor,
          title: t('Match system theme'),
        },
      ]}
    />
  );
}
