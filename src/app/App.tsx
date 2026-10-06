import { createBrowserRouter, Navigate } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { RouteError } from './pages/RouteError';

const readerRoutes: Parameters<typeof createBrowserRouter>[0] = [
  {
    path: '/read/*',
    lazy: async () => ({ Component: (await import('@/reader/ReaderApp')).ReaderApp }),
    errorElement: <RouteError />,
    hydrateFallbackElement: <div className="min-h-dvh" />,
  },
];
// This feature deployment is PDF-only. The shared toolbox remains available to its
// original builds and regression suite through an explicit build-time selection.
const routes: Parameters<typeof createBrowserRouter>[0] = import.meta.env.VITE_APP_MODE === 'toolbox' ? [...readerRoutes, {
    path: '/',
    lazy: async () => ({ Component: (await import('./Layout')).Layout }),
    errorElement: <RouteError />,
    hydrateFallbackElement: <div className="min-h-dvh" />,
    children: [
      { index: true, lazy: async () => ({ Component: (await import('./pages/HomePage')).HomePage }) },
      { path: 'tools', lazy: async () => ({ Component: (await import('./pages/AllToolsPage')).AllToolsPage }) },
      { path: 'tools/*', lazy: async () => ({ Component: (await import('./pages/ToolPage')).ToolPage }) },
      {
        path: 'category/:categoryId',
        lazy: async () => ({ Component: (await import('./pages/CategoryPage')).CategoryPage }),
      },
      { path: 'favorites', lazy: async () => ({ Component: (await import('./pages/FavoritesPage')).FavoritesPage }) },
      { path: 'settings', lazy: async () => ({ Component: (await import('./pages/SettingsPage')).SettingsPage }) },
      { path: 'privacy', lazy: async () => ({ Component: (await import('./pages/PrivacyPage')).PrivacyPage }) },
      { path: '*', lazy: async () => ({ Component: (await import('./pages/NotFoundPage')).NotFoundPage }) },
    ],
  }] : [...readerRoutes, { path: '*', element: <Navigate to="/read" replace /> }];

let router: ReturnType<typeof createBrowserRouter> | null = null;

export function App() {
  // Created on first render, after the interface language has loaded: the router starts loading
  // the current page right away, and pages may translate labels when their module loads.
  router ??= createBrowserRouter(routes);
  return <RouterProvider router={router} />;
}
