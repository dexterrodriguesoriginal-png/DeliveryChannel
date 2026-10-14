import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { detachGlobalManifestForStoreRoute } from './lib/pwa/applyStoreIdentity';
import { captureInstallEvents } from './lib/pwa/installState';

// Captura beforeinstallprompt/appinstalled antes do React montar.
captureInstallEvents(window);

// Rotas de loja (/app/<slug>) nunca herdam o manifesto global da plataforma.
detachGlobalManifestForStoreRoute(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
