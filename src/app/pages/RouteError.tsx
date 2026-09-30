import { isRouteErrorResponse, useRouteError } from 'react-router';
import { logDevError } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Last-resort error screen when the shell itself fails. Deliberately dependency-free. */
export function RouteError() {
  const error = useRouteError();
  logDevError('Route error', error);
  const status = isRouteErrorResponse(error) ? error.status : null;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[22px] font-semibold tracking-tight text-fg">
        {status === 404 ? t('Page not found') : t('Something went wrong')}
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        {status === 404
          ? t('This page does not exist.')
          : t('LocalKit hit an unexpected error. Your local data is safe. Reloading usually fixes this.')}
      </p>
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast"
        >
          {t('Reload')}
        </button>
        <a href="/" className="inline-flex h-9 items-center rounded-lg border border-line-strong px-4 text-sm text-fg">
          {t('Home')}
        </a>
      </div>
    </div>
  );
}
