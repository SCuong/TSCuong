import { Component, lazy, Suspense, useEffect, useMemo, type ComponentType, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { ChevronRight, Globe, HardDrive, Pin, PinOff, RotateCcw, Star, WifiOff } from 'lucide-react';
import { getToolByRoute } from '@/tools/registry';
import { getCategory } from '@/tools/categories';
import type { BrowserRequirement, ToolDefinition } from '@/tools/types';
import { ToolContext } from '@/tools/context';
import { recordToolVisit, toggleFavorite, togglePinned, useFavorites, usePinned } from '@/lib/userPrefs';
import { ToolIcon } from '@/components/ToolIcon';
import { Button, IconButton } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { cn, logDevError } from '@/lib/utils';
import { useDocumentTitle } from '../useDocumentTitle';
import { NotFoundPage } from './NotFoundPage';
import { t } from '@/lib/i18n';

const REQUIREMENT_CHECKS: Record<BrowserRequirement, { test: () => boolean; message: string }> = {
  fileSystemAccess: {
    test: () => 'showDirectoryPicker' in window,
    message: t('folder access (File System Access API), available in Chrome, Edge and other Chromium browsers'),
  },
  offscreenCanvas: { test: () => typeof OffscreenCanvas !== 'undefined', message: t('OffscreenCanvas') },
  webCrypto: { test: () => Boolean(globalThis.crypto?.subtle), message: t('the Web Crypto API (requires HTTPS or localhost)') },
  camera: { test: () => Boolean(navigator.mediaDevices?.getUserMedia), message: t('camera access') },
  clipboardRead: { test: () => Boolean(navigator.clipboard?.read), message: t('reading from the clipboard') },
  webAssembly: { test: () => typeof WebAssembly === 'object', message: t('WebAssembly') },
  indexedDB: { test: () => typeof indexedDB !== 'undefined', message: t('IndexedDB storage') },
};

/** Requirements that make the tool unusable (others only disable a feature, handled by the tool itself). */
const HARD_REQUIREMENTS: BrowserRequirement[] = ['webCrypto', 'webAssembly'];

const componentCache = new Map<string, ComponentType>();
function lazyTool(tool: ToolDefinition): ComponentType {
  let cached = componentCache.get(tool.id);
  if (!cached) {
    cached = lazy(tool.load);
    componentCache.set(tool.id, cached);
  }
  return cached;
}

class ToolErrorBoundary extends Component<{ children: ReactNode; toolId: string }, { error: unknown }> {
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

function NetworkBadge({ tool }: { tool: ToolDefinition }) {
  const network = tool.network ?? 'none';
  const Icon = network === 'none' ? HardDrive : network === 'required' ? Globe : WifiOff;
  const label =
    network === 'none'
      ? t('Runs locally')
      : network === 'required'
        ? t('Makes network requests you send')
        : t('Local, optional network');
  return (
    <span
      title={tool.networkNote ? t(tool.networkNote) : (network === 'none' ? t('Everything happens in your browser. Nothing is uploaded.') : undefined)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium',
        network === 'none' ? 'border-transparent bg-success-soft text-success' : 'border-line bg-surface-hover text-fg-secondary',
      )}
    >
      <Icon size={12} aria-hidden />
      {label}
    </span>
  );
}

export function ToolPage() {
  const params = useParams();
  const location = useLocation();
  const route = (params['*'] ?? '').replace(/^\/+|\/+$/g, '');
  const tool = getToolByRoute(route);
  const isRedirect = Boolean(tool && tool.route !== route);
  useDocumentTitle(tool ? t(tool.name) : t('Tool not found'));

  useEffect(() => {
    if (tool && !isRedirect) recordToolVisit(tool.id);
  }, [tool, isRedirect]);

  if (!tool) return <NotFoundPage message={t('There is no tool at /tools/{route}.', { route })} />;
  if (isRedirect) return <Navigate to={`/tools/${tool.route}${location.search}${location.hash}`} replace />;
  return <ToolView key={tool.id} tool={tool} />;
}

function ToolView({ tool }: { tool: ToolDefinition }) {
  const favorites = useFavorites();
  const pinned = usePinned();
  const category = getCategory(tool.category);
  const ToolComponent = lazyTool(tool);
  const isFavorite = favorites.includes(tool.id);
  const isPinned = pinned.includes(tool.id);
  const missing = useMemo(
    () => (tool.requires ?? []).filter((r) => HARD_REQUIREMENTS.includes(r) && !REQUIREMENT_CHECKS[r].test()),
    [tool],
  );
  const layout = tool.layout ?? 'standard';

  return (
    <ToolContext.Provider value={tool}>
      <div
        className={cn(
          'mx-auto px-4 pt-5 pb-12 sm:px-6 lg:px-8',
          layout === 'standard' ? 'max-w-[1240px]' : layout === 'wide' ? 'max-w-[1600px]' : 'max-w-none',
        )}
      >
        <nav aria-label={t('Breadcrumb')} className="lk-no-print mb-3 flex items-center gap-1 text-[12.5px] text-fg-muted">
          <Link to="/" className="hover:text-fg">
            {t('Home')}
          </Link>
          <ChevronRight size={13} aria-hidden />
          <Link to={`/category/${category.id}`} className="hover:text-fg">
            {t(category.name)}
          </Link>
        </nav>
        <header className="lk-no-print mb-5 flex flex-wrap items-start gap-x-4 gap-y-3">
          <ToolIcon icon={tool.icon} hue={category.hue} size="lg" />
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[24px]">{t(tool.name)}</h1>
            <p className="mt-1 text-[14px] text-fg-secondary">{t(tool.description)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <NetworkBadge tool={tool} />
            <IconButton
              icon={Star}
              label={isFavorite ? t('Remove from favorites') : t('Add to favorites')}
              aria-pressed={isFavorite}
              onClick={() => toggleFavorite(tool.id)}
              className={isFavorite ? 'text-warm hover:text-warm [&_svg]:fill-current' : undefined}
            />
            <IconButton
              icon={isPinned ? PinOff : Pin}
              label={isPinned ? t('Unpin from sidebar') : t('Pin to sidebar')}
              aria-pressed={isPinned}
              onClick={() => togglePinned(tool.id)}
              className={isPinned ? 'text-accent-text' : undefined}
            />
          </div>
        </header>

        {missing.length > 0 ? (
          <Alert tone="warning" title={t('Your browser does not support this tool')}>
            {t('It needs {features}. Try a current version of Chrome, Edge, Firefox or Safari.', {
              features: missing.map((r) => REQUIREMENT_CHECKS[r].message).join(', '),
            })}
          </Alert>
        ) : (
          <ToolErrorBoundary toolId={tool.id}>
            <Suspense
              fallback={
                <div className="flex justify-center rounded-xl border border-line bg-surface py-20">
                  <Spinner label={t('Loading {name}…', { name: t(tool.name) })} />
                </div>
              }
            >
              <ToolComponent />
            </Suspense>
          </ToolErrorBoundary>
        )}
      </div>
    </ToolContext.Provider>
  );
}
