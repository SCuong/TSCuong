import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { logDevError } from '@/lib/utils';
import { t } from '@/lib/i18n';

export class ToolErrorBoundary extends Component<{ children: ReactNode; toolId: string }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    logDevError(`Tool "${this.props.toolId}" crashed`, error);
  }
  override componentDidUpdate(prev: { toolId: string }) {
    if (prev.toolId !== this.props.toolId && this.state.error) this.setState({ error: null });
  }
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunkFailed =
      error instanceof Error && /dynamically imported module|Loading chunk|Importing a module script failed|error loading/i.test(error.message);
    return (
      <Alert
        tone="danger"
        title={chunkFailed ? t('This tool could not be loaded') : t('This tool ran into a problem')}
        action={
          chunkFailed ? (
            <Button size="sm" icon={RotateCcw} onClick={() => window.location.reload()}>
              {t('Reload')}
            </Button>
          ) : (
            <Button size="sm" icon={RotateCcw} onClick={() => this.setState({ error: null })}>
              {t('Try again')}
            </Button>
          )
        }
      >
        {chunkFailed
          ? t('You may be offline, or LocalKit was updated since this page loaded. Reload to fetch the latest version.')
          : t('Something unexpected happened while rendering. Your data was not sent anywhere. Try again, or reload the page.')}
        {import.meta.env.DEV && error instanceof Error && (
          <pre className="mt-2 max-h-40 overflow-auto text-[11.5px] whitespace-pre-wrap opacity-80">{error.stack}</pre>
        )}
      </Alert>
    );
  }
}
