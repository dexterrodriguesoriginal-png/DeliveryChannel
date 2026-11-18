// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { StoreVisualUpdateNotice, VISUAL_NOTICE_TEXT } from '../StoreVisualUpdateNotice';
import { serverManifest } from '../../../../server/pwa/routes';
import type { StoreIdentityInput } from '../../../lib/pwa/storeManifest';
import { readVisualRecord, recordInstalledVisual, webApkFingerprint } from '../../../lib/pwa/webApkVisual';
import { captureInstallEvents } from '../../../lib/pwa/installState';

const store: StoreIdentityInput = { id: 'tenant-1', slug: 'adegasshow', name: 'ADEGASSHOW', theme: { logoUrl: 'https://cdn.example/l.png', navBarColor: '#1b6004' } };
const v2: StoreIdentityInput = { ...store, theme: { ...store.theme, navBarColor: '#0b0b0f' } };
const fetchFor = (s: StoreIdentityInput) => vi.fn().mockImplementation(async () =>
  new Response(JSON.stringify(serverManifest(s)), { status: 200, headers: { 'content-type': 'application/manifest+json' } })) as unknown as typeof fetch;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('aviso "Visual atualizado" no app instalado', () => {
  it('mostra quando o visual mudou desde a instalação; "Como fazer" abre os passos; "Agora não" esconde e não volta', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', webApkFingerprint(serverManifest(store)));
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} />);
    const notice = await ui.findByTestId('visual-update-notice');
    expect(notice.textContent).toContain(VISUAL_NOTICE_TEXT);
    expect(notice.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i); // só tokens do tema
    expect(ui.queryByTestId('visual-update-steps')).toBeNull();
    fireEvent.click(ui.getByTestId('visual-update-help'));
    expect(ui.getByTestId('visual-update-steps').textContent).toContain('Instalar app');
    fireEvent.click(ui.getByTestId('visual-update-dismiss'));
    expect(ui.queryByTestId('visual-update-notice')).toBeNull();
    cleanup();
    const again = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await new Promise(r => setTimeout(r, 10));
    expect(again.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('visual igual ao instalado ou primeira abertura sem registro: sem aviso (grava base)', async () => {
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(store)} storage={localStorage} />);
    await waitFor(() => expect(readVisualRecord(localStorage, 'adegasshow').installed).toBe(webApkFingerprint(serverManifest(store))));
    expect(ui.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('no navegador comum nunca mostra; hidden esconde durante o checkout', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', 'antigo');
    const tab = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone={false} fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await new Promise(r => setTimeout(r, 10));
    expect(tab.queryByTestId('visual-update-notice')).toBeNull();
    cleanup();
    const app = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone hidden fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await new Promise(r => setTimeout(r, 10));
    expect(app.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('iPhone/desktop instalado (standalone) nunca mostra o aviso do Android', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', 'antigo');
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android={false} standalone fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await new Promise(r => setTimeout(r, 10));
    expect(ui.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('appinstalled na aba do Chrome grava o visual instalado (após reinstalar o aviso some)', async () => {
    captureInstallEvents(window);
    recordInstalledVisual(localStorage, 'adegasshow', 'antigo');
    render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone={false} fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    await waitFor(() => expect(readVisualRecord(localStorage, 'adegasshow').installed).toBe(webApkFingerprint(serverManifest(v2))));
    cleanup();
    const app = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await new Promise(r => setTimeout(r, 10));
    expect(app.queryByTestId('visual-update-notice')).toBeNull();
  });
});
