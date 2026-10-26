import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { injectDriverHead, isDriverRoute } from '../driverManifest';
import { decideInvite, readInvite, recordAccepted, recordInvite } from '../installState';

describe('instalação do app do entregador', () => {
  it('tem identidade própria, start_url sem token e escopo do entregador', () => {
    const manifest = JSON.parse(readFileSync('public/driver.webmanifest', 'utf8'));
    expect(manifest.id).toBe('/entregador');
    expect(manifest.start_url).toBe('/entregador');
    expect(manifest.scope).toBe('/entregador');
    for (const route of ['/entregador', '/entregador/convite/token', '/convite-entregador']) expect(isDriverRoute(route)).toBe(true);
    expect(isDriverRoute('/app/loja')).toBe(false);
    expect(isDriverRoute('/')).toBe(false);
    const html = injectDriverHead('<head><title>Loja</title><link rel="manifest" href="/manifest.json" /></head>');
    expect(html).toContain('href="/driver.webmanifest"');
    expect(html).not.toContain('href="/manifest.json"');
    expect(html.match(/rel="manifest"/g)).toHaveLength(1);
  });
  it('convite de visita sem limite por sessão; instalado não recebe convite', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v) };
    recordInvite(storage, 'driver-app', 1000);
    recordAccepted(storage, 'driver-app', 1000);
    // O entregador renova a visita, sem aplicar o intervalo do cliente.
    const visit = { now: 2000, trigger: 'visit' as const, record: readInvite(storage, 'driver-app'), audience: 'driver' as const, installed: false, standalone: false, busy: false };
    expect(decideInvite(visit)).toBe('modal');
    expect(decideInvite({ ...visit, installed: true })).toBeNull();
    expect(decideInvite({ ...visit, standalone: true })).toBeNull();
  });
});
