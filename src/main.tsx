import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/index.css';
import './lib/theme';
import { initLocale } from './lib/i18n';
import { App } from './app/App';

// Render once the interface language is loaded, so nothing flashes in the wrong language.
void initLocale().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
