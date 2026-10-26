import React, { useEffect } from 'react';
import { InstallStoreAppHint, ensureDriverManifest } from '../client/InstallStoreAppHint';
import { DRIVER_APP_NAME, DRIVER_START_PATH, isDriverRoute } from '../../lib/pwa/driverManifest';

/** Identidade própria, compartilhada entre convite e app; fechar nunca impede usar a web. */
export function InstallDriverAppHint() {
  const onDriverRoute = isDriverRoute(window.location.pathname);
  // Chegou por navegação interna (ex.: login em /): troca o manifesto para o Chrome oferecer o app certo.
  useEffect(() => { if (onDriverRoute) ensureDriverManifest(document); }, [onDriverRoute]);
  if (!onDriverRoute) return null;
  return <InstallStoreAppHint tenantId="driver-app" storeName={DRIVER_APP_NAME} color="#f59e0b"
    audience="driver" startPath={DRIVER_START_PATH} bottomOffset={80} />;
}
