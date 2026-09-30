import { ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { describeHosts } from '@/lib/remoteContent';
import { cn, pluralize } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * Shown above a preview whose remote images were blocked by `blockRemoteContent`.
 * Loading them is an explicit choice because it contacts the servers they come from.
 */
export function RemoteContentNotice({
  blocked,
  hosts,
  onAllow,
  className,
}: {
  blocked: number;
  hosts: string[];
  onAllow: () => void;
  className?: string;
}) {
  if (blocked === 0) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[12.5px] text-fg-secondary',
        className,
      )}
    >
      <ImageOff size={14} aria-hidden className="shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1">
        {t('{count} from {hosts} not loaded, so this preview makes no network requests.', {
          count: pluralize(blocked, t('remote image'), t('remote images')),
          hosts: describeHosts(hosts),
        })}
      </span>
      <Button size="sm" onClick={onAllow}>
        {t('Load images')}
      </Button>
    </div>
  );
}
