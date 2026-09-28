import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from './Layout';
import { RouteError } from './pages/RouteError';

const router = createBrowserRouter([
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
]);

export function App() {
  return <RouterProvider router={router} />;
}
