// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { StoreVisualUpdateNotice, VISUAL_BAR_HELP_TEXT, VISUAL_UPDATE_BUTTON } from '../StoreVisualUpdateNotice';
import { serverManifest } from '../../../../server/pwa/routes';
import type { StoreIdentityInput } from '../../../lib/pwa/storeManifest';
import { readVisualRecord, recordInstalledVisual, webApkFingerprint } from '../../../lib/pwa/webApkVisual';
import { captureInstallEvents } from '../../../lib/pwa/installState';

const store: StoreIdentityInput = { id: 'tenant-1', slug: 'adegasshow', name: 'ADEGASSHOW', theme: { logoUrl: 'https://cdn.example/l.png', navBarColor: '#1b6004' } };
const v2: StoreIdentityInput = { ...store, theme: { ...store.theme, navBarColor: '#0b0b0f' } };
const fetchFor = (s: StoreIdentityInput) => vi.fn().mockImplementation(async () =>
  new Response(JSON.stringify(serverManifest(s)), { status: 200, headers: { 'content-type': 'application/manifest+json' } })) as unknown as typeof fetch;
const tick = () => new Promise(r => setTimeout(r, 10));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('botão "Atualizar app" no app instalado', () => {
  it('compacto: só "Atualizar app", link pequeno e X; sem texto longo nem passos; só tokens do tema', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', webApkFingerprint(serverManifest(store)));
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} onRefresh={vi.fn()} />);
    const notice = await ui.findByTestId('visual-update-notice');
    expect(ui.getByTestId('visual-update-refresh').textContent).toBe(VISUAL_UPDATE_BUTTON);
    expect(notice.textContent).toBe(`${VISUAL_UPDATE_BUTTON}barra não mudou?`);
    expect(notice.textContent).not.toMatch(/Como fazer|Agora não|Desinstalar/);
    expect(notice.querySelector('ol')).toBeNull();
    expect(notice.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    fireEvent.click(ui.getByTestId('visual-update-help'));
    expect(ui.getByTestId('visual-update-help-text').textContent).toBe(VISUAL_BAR_HELP_TEXT);
  });

  it('"Atualizar app" atualiza e marca o visual como resolvido: depois da recarga não volta', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', webApkFingerprint(serverManifest(store)));
    const onRefresh = vi.fn();
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} onRefresh={onRefresh} />);
    await ui.findByTestId('visual-update-notice');
    await act(async () => { fireEvent.click(ui.getByTestId('visual-update-refresh')); });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(readVisualRecord(localStorage, 'adegasshow').dismissed).toBe(webApkFingerprint(serverManifest(v2)));
    cleanup();
    // "Depois da recarga": o WebAPK ainda tem a barra antiga, mas o botão não aparece de novo.
    const after = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} onRefresh={onRefresh} />);
    await tick();
    expect(after.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('X fecha e não volta para o mesmo visual', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', webApkFingerprint(serverManifest(store)));
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} onRefresh={vi.fn()} />);
    await ui.findByTestId('visual-update-notice');
    fireEvent.click(ui.getByTestId('visual-update-close'));
    expect(ui.queryByTestId('visual-update-notice')).toBeNull();
    cleanup();
    const again = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await tick();
    expect(again.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('visual igual ao instalado ou primeira abertura sem registro: nada (grava base)', async () => {
    const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(store)} storage={localStorage} />);
    await waitFor(() => expect(readVisualRecord(localStorage, 'adegasshow').installed).toBe(webApkFingerprint(serverManifest(store))));
    expect(ui.queryByTestId('visual-update-notice')).toBeNull();
  });

  it('navegador comum, iPhone/desktop ou hidden: nunca mostra', async () => {
    recordInstalledVisual(localStorage, 'adegasshow', 'antigo');
    for (const props of [{ android: true, standalone: false }, { android: false, standalone: true }, { android: true, standalone: true, hidden: true }]) {
      const ui = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" {...props} fetchImpl={fetchFor(v2)} storage={localStorage} />);
      await tick();
      expect(ui.queryByTestId('visual-update-notice')).toBeNull();
      cleanup();
    }
  });

  it('appinstalled na aba do Chrome grava o visual instalado (após reinstalar nada aparece)', async () => {
    captureInstallEvents(window);
    recordInstalledVisual(localStorage, 'adegasshow', 'antigo');
    render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone={false} fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await act(async () => { window.dispatchEvent(new Event('appinstalled')); });
    await waitFor(() => expect(readVisualRecord(localStorage, 'adegasshow').installed).toBe(webApkFingerprint(serverManifest(v2))));
    cleanup();
    const app = render(<StoreVisualUpdateNotice slug="adegasshow" tenantId="tenant-1" android standalone fetchImpl={fetchFor(v2)} storage={localStorage} />);
    await tick();
    expect(app.queryByTestId('visual-update-notice')).toBeNull();
  });
});
