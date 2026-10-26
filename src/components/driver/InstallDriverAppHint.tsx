import React from 'react';
import { InstallStoreAppHint } from '../client/InstallStoreAppHint';
import { DRIVER_APP_NAME, DRIVER_START_PATH, isDriverRoute } from '../../lib/pwa/driverManifest';

/** Identidade própria, compartilhada entre convite e app; fechar nunca impede usar a web. */
export function InstallDriverAppHint() {
  if (!isDriverRoute(window.location.pathname)) return null;
  return <InstallStoreAppHint tenantId="driver-app" storeName={DRIVER_APP_NAME} color="#f59e0b"
    audience="driver" startPath={DRIVER_START_PATH} bottomOffset={80} />;
}
