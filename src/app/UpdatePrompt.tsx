import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { t } from '@/lib/i18n';

/**
 * Registers the service worker (production only) and offers a reload when a
 * new version has been downloaded. Never reloads on its own, so no one loses
 * work in progress.
 */
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateRef = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      updateRef.current = registerSW({
        onNeedRefresh() {
          setNeedRefresh(true);
        },
        onOfflineReady() {
          toast(t('LocalKit is ready to work offline.'), 'info', 4000);
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-[90] flex max-w-[calc(100%-32px)] items-center gap-3 rounded-lg border border-line-strong bg-surface-raised py-2 pr-2 pl-3.5 text-[13px] shadow-popover"
    >
      <span>{t('A new version of LocalKit is available.')}</span>
      <Button size="sm" variant="primary" icon={RefreshCw} onClick={() => void updateRef.current?.(true)}>
        {t('Reload')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        {t('Later')}
      </Button>
    </div>
  );
}
