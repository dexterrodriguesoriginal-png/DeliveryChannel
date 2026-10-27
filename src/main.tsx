import { driverAuthReturnPath } from './lib/driverInviteFlow';
import { DRIVER_MANIFEST_PATH, isDriverRoute } from './lib/pwa/driverManifest';
import { INVITE_TOKEN_SESSION_KEY } from './utils/inviteUrl';
import { WAITER_MANIFEST_PATH, isWaiterRoute } from './lib/pwa/waiterManifest';
import { toolsPathRedirect } from './lib/panelRoute';
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

if (isWaiterRoute(window.location.pathname)) {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]') || document.createElement('link');
  manifest.rel = 'manifest'; manifest.href = WAITER_MANIFEST_PATH;
  document.head.appendChild(manifest);
}
// /modulos e /ferramentas abrem a página Ferramentas do painel (o endereço antigo continua funcionando).
const toolsTarget = toolsPathRedirect(window.location.pathname);
if (toolsTarget) window.history.replaceState(null, '', toolsTarget);

// Captura beforeinstallprompt/appinstalled antes do React montar.
captureInstallEvents(window);

// Rotas de loja (/app/<slug>) nunca herdam o manifesto global da plataforma.
detachGlobalManifestForStoreRoute(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
