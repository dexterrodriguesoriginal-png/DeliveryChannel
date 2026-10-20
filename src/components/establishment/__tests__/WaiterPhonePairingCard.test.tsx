import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WaiterPhonePairingCard, waiterEntryUrl } from '../WaiterPhonePairingCard';

describe('waiter phone access', () => {
  it('uses a direct waiter route and explains staff login', () => {
    expect(waiterEntryUrl('https://shop.example/')).toBe('https://shop.example/garcom');
    const html = renderToStaticMarkup(<WaiterPhonePairingCard />);
    expect(html).toContain('Acesso do garçom pelo celular');
    expect(html).toContain('painel abre direto no Salão');
    expect(html).toContain('Conectar celular');
  });
});
