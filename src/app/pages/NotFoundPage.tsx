import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { openPalette } from '../paletteStore';
import { useDocumentTitle } from '../useDocumentTitle';

export function NotFoundPage({ message }: { message?: string }) {
  useDocumentTitle('Page not found');
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <p className="font-mono text-[13px] text-fg-muted">404</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-fg">Page not found</h1>
      <p className="mt-2 text-sm text-fg-secondary">{message ?? 'This page does not exist. It may have moved.'}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" icon={Search} onClick={() => openPalette()}>
          Search tools
        </Button>
        <Link
          to="/"
          className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface-raised px-3.5 text-sm font-medium text-fg shadow-card hover:bg-surface-hover"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
