import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/Feedback';
import { hasOcrPack, prepareOcrPack } from './offlinePack';
import { t } from '@/lib/i18n';
export function OfflineOcr() {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { let alive = true; void hasOcrPack().then((value) => { if (alive) setReady(value); }).catch(() => {}); return () => { alive = false; abort.current?.abort(); }; }, []);
  async function prepare() {
    const controller = new AbortController(); abort.current = controller;
    setProgress(0); setFailed(false);
    try {
      await prepareOcrPack(controller.signal, (value) => { if (!controller.signal.aborted) setProgress(value); });
      if (!controller.signal.aborted) setReady(true);
    } catch (error) { if ((error as Error).name !== 'AbortError') setFailed(true); }
    finally { if (abort.current === controller) { abort.current = null; setProgress(null); } }
  }
  return <div className="reader-settings">
    <h3>{t('Offline OCR')}</h3>
    <p className="reader-muted">{t('Prepare the English OCR engine while online to recognize scans and photos offline. The download includes the language model and CPU variants; files stay on this device.')}</p>
    {progress !== null ? <ProgressBar value={progress} label={t('Preparing offline OCR…')} onCancel={() => abort.current?.abort()} /> : <Button disabled={ready} onClick={() => void prepare()}>{ready ? t('English OCR is ready offline') : t('Prepare English OCR for offline use')}</Button>}
    {failed && <p role="alert">{t('Could not prepare offline OCR. Open LocalKit online, reload, and try again.')}</p>}
  </div>;
}
