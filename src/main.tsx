import { driverAuthReturnPath } from './lib/driverInviteFlow';
import { DRIVER_MANIFEST_PATH, isDriverRoute } from './lib/pwa/driverManifest';
import { INVITE_TOKEN_SESSION_KEY } from './utils/inviteUrl';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { detachGlobalManifestForStoreRoute } from './lib/pwa/applyStoreIdentity';
import { captureInstallEvents } from './lib/pwa/installState';

// O retorno do Google usa URL sem token; normaliza para dentro do escopo do entregador.
if (window.location.pathname === '/convite-entregador') {
  const queryToken = new URLSearchParams(window.location.search).get('token');
  if (queryToken) sessionStorage.setItem(INVITE_TOKEN_SESSION_KEY, queryToken);
  // Preserva code/fragmento OAuth até o Supabase consumir a sessão.
  window.history.replaceState(null, '', driverAuthReturnPath(window.location.search, window.location.hash));
}
if (isDriverRoute(window.location.pathname)) {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]') || document.createElement('link');
  manifest.rel = 'manifest'; manifest.href = DRIVER_MANIFEST_PATH;
  document.head.appendChild(manifest);
}

// Captura beforeinstallprompt/appinstalled antes do React montar.
captureInstallEvents(window);

// Rotas de loja (/app/<slug>) nunca herdam o manifesto global da plataforma.
detachGlobalManifestForStoreRoute(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
