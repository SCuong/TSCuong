import { Link } from 'react-router';
import { Globe, HardDrive, WifiOff } from 'lucide-react';
import { TOOLS, toolPath } from '@/tools/registry';
import { Panel } from '@/components/ui/Panel';
import { useDocumentTitle } from '../useDocumentTitle';
import { t } from '@/lib/i18n';

export function PrivacyPage() {
  useDocumentTitle(t('Privacy'));
  const networkTools = TOOLS.filter((t) => t.network && t.network !== 'none');

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-fg">{t('Privacy')}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-fg-secondary">
        {t('LocalKit is local-first. There is no account, no backend, no analytics and no tracking. Tools run in your browser using JavaScript, WebAssembly, Web Workers and Web Crypto.')}
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <Panel title={t('What stays on your device')}>
          <ul className="flex flex-col gap-3 text-[14px] text-fg-secondary">
            <li className="flex gap-3">
              <HardDrive size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <span>
                {t('Files you open (PDFs, images, databases, spreadsheets, folders) are read and processed in this browser tab. They are never uploaded.')}
              </span>
            </li>
            <li className="flex gap-3">
              <HardDrive size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <span>
                {t('Notes, snippets, diagrams, API collections, favorites and history are stored in this browser (IndexedDB and localStorage). Delete them any time from')}{' '}<Link to="/settings" className="text-accent-text underline">{t('Settings')}</Link>.
              </span>
            </li>
            <li className="flex gap-3">
              <WifiOff size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <span>
                {t('After the first visit the app is cached by a service worker, so most tools keep working offline. Heavy engines (PDF, OCR, SQLite, Mermaid) are downloaded from this site the first time you use them and cached for offline use.')}
              </span>
            </li>
          </ul>
        </Panel>

        <Panel title={t('When the network is used')}>
          <p className="text-[14px] text-fg-secondary">
            {t('Only these tools can make network requests, and only when you explicitly trigger them:')}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {networkTools.map((tool) => (
              <li key={tool.id} className="flex gap-3 text-[14px]">
                <Globe size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
                <span>
                  <Link to={toolPath(tool)} className="font-medium text-fg hover:underline">
                    {t(tool.name)}
                  </Link>
                  {tool.networkNote && <span className="text-fg-secondary"> — {t(tool.networkNote)}</span>}
                </span>
              </li>
            ))}
            {networkTools.length === 0 && <li className="text-[14px] text-fg-muted">{t('No tool uses the network.')}</li>}
          </ul>
        </Panel>

        <Panel title={t('Credentials')}>
          <p className="text-[14px] text-fg-secondary">
            {t('Secrets you type (passwords, keys, tokens) are processed in memory. The API client does not save Authorization headers or auth settings to history; they are stored only when you deliberately save a request, and you are warned when you do.')}
          </p>
        </Panel>
      </div>
    </div>
  );
}
