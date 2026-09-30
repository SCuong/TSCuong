import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from './Layout';
import { RouteError } from './pages/RouteError';

const routes: Parameters<typeof createBrowserRouter>[0] = [
  {
    path: '/',
    element: <Layout />,
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
  },
];

let router: ReturnType<typeof createBrowserRouter> | null = null;

export function App() {
  // Created on first render, after the interface language has loaded: the router starts loading
  // the current page right away, and pages may translate labels when their module loads.
  router ??= createBrowserRouter(routes);
  return <RouterProvider router={router} />;
}
