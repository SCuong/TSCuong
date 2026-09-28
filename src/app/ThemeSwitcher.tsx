import { Monitor, Moon, Sun } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { setThemePreference, useTheme, type ThemePreference } from '@/lib/theme';

export function ThemeSwitcher({ withLabels = false, className }: { withLabels?: boolean; className?: string }) {
  const { preference } = useTheme();
  return (
    <Segmented<ThemePreference>
      label="Color theme"
      size="sm"
      className={className}
      value={preference}
      onChange={setThemePreference}
      options={[
        { value: 'light', label: withLabels ? 'Light' : <span className="sr-only">Light</span>, icon: Sun, title: 'Light theme' },
        { value: 'dark', label: withLabels ? 'Dark' : <span className="sr-only">Dark</span>, icon: Moon, title: 'Dark theme' },
        {
          value: 'system',
          label: withLabels ? 'System' : <span className="sr-only">System</span>,
          icon: Monitor,
          title: 'Match system theme',
        },
      ]}
    />
  );
}
