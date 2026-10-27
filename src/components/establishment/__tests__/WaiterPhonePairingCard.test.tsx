import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: { name: 'Loja' } }) }));
import { WaiterPhonePairingCard, waiterEntryUrl } from '../WaiterPhonePairingCard';

describe('waiter phone access', () => {
  it('uses a direct waiter route and explains staff login', () => {
    expect(waiterEntryUrl('https://shop.example/')).toBe('https://shop.example/garcom');
    const html = renderToStaticMarkup(<WaiterPhonePairingCard />);
    expect(html).toContain('Acesso do garçom pelo celular');
    expect(html).toContain('abre o Aplicativo do Garçom');
    expect(html).toContain('Ocultar QR');
    expect(html).toContain('waiter-access-qr');
  });
});
