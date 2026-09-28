import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation, useNavigation } from 'react-router';
import { Menu, Search, Settings, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Panel';
import { Toaster } from '@/components/ui/Toast';
import { Spinner } from '@/components/ui/Feedback';
import { modKey } from '@/lib/utils';
import { SidebarContent } from './Sidebar';
import { ThemeSwitcher } from './ThemeSwitcher';
import { CommandPalette } from './CommandPalette';
import { openPalette, togglePalette } from './paletteStore';
import { UpdatePrompt } from './UpdatePrompt';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || Boolean(target.closest('.cm-editor'));
}

function useGlobalShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
      } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        openPalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-[min(300px,86vw)] max-w-none border-0 border-r border-line bg-surface p-0 text-fg shadow-popover backdrop:bg-overlay open:[animation:lk-slide-in-left_180ms_cubic-bezier(0.2,0.9,0.3,1)]"
    >
      <div className="flex h-full flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <Logo />
          <IconButton icon={X} label="Close navigation" onClick={onClose} />
        </div>
        <div className="border-b border-line px-4 py-3">
          <ThemeSwitcher withLabels className="w-full [&>button]:flex-1" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{open && <SidebarContent onNavigate={onClose} />}</div>
      </div>
    </dialog>
  );
}

function NavigationProgress() {
  const navigation = useNavigation();
  if (navigation.state === 'idle') return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" role="progressbar" aria-label="Loading page">
      <div className="h-full w-1/3 bg-accent [animation:lk-indeterminate_0.9s_ease-in-out_infinite]" />
    </div>
  );
}

export function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useGlobalShortcuts();

  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-accent px-3 py-2 text-accent-contrast focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <NavigationProgress />
      <header className="lk-no-print sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/75">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4 lg:px-5">
          <IconButton icon={Menu} label="Open navigation" className="lg:hidden" onClick={() => setNavOpen(true)} />
          <Link to="/" className="shrink-0 rounded-md" aria-label="LocalKit home">
            <Logo />
          </Link>
          <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-4">
            <button
              type="button"
              onClick={() => openPalette()}
              className="group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-line-strong bg-surface-sunken px-3 text-left text-[13.5px] text-fg-muted shadow-card transition-colors hover:border-accent-line hover:text-fg-secondary"
              aria-label="Search tools"
              aria-keyshortcuts="Control+K Meta+K"
            >
              <Search size={15} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <span className="hidden sm:inline">Search 100+ tools…</span>
                <span className="sm:hidden">Search…</span>
              </span>
              <span className="hidden items-center gap-1 sm:flex">
                <Kbd>{modKey}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
          </div>
          <ThemeSwitcher className="hidden md:inline-flex" />
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="hidden size-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg sm:inline-flex"
          >
            <Settings size={17} aria-hidden />
          </Link>
        </div>
      </header>

      <div className="flex">
        <aside className="lk-no-print sticky top-14 hidden h-[calc(100dvh-56px)] w-60 shrink-0 overflow-y-auto border-r border-line lg:block">
          <SidebarContent />
        </aside>
        <main id="main" className="min-w-0 flex-1" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="flex justify-center py-24">
                <Spinner label="Loading…" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
      <CommandPalette />
      <UpdatePrompt />
      <Toaster />
      <ScrollRestoration />
    </div>
  );
}
