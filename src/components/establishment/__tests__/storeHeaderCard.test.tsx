import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreHeaderCard } from '../dashboard/StoreHeaderCard';

const tenant = { id: 't', slug: 'bar-do-ney', name: 'Bar do Ney', theme: { storeName: 'Bar do Ney', primaryColor: '#15803d' }, settings: { isOpen: true } } as any;

describe('StoreHeaderCard (Dashboard)', () => {
  it('nome, selo aberta, link público /app/<slug> e atalhos; sem plano/dias restantes', () => {
    const html = renderToStaticMarkup(<StoreHeaderCard tenant={tenant} isOpen canToggleOpen onToggleOpen={() => {}} onOpenMarketing={() => {}} />);
    expect(html).toContain('Bar do Ney');
    expect(html).toContain('Loja aberta');
    expect(html).toMatch(/\/app\/bar-do-ney/);
    for (const t of ['Fechar loja', 'Ver loja', 'Copiar link', 'QR Code', 'Banners &amp; Ofertas']) expect(html).toContain(t);
    expect(html).not.toMatch(/Plano|Dias restantes|ADEGA/i);
  });
  it('sem permissão de configurações não mostra Abrir/Fechar; fechada mostra selo vermelho', () => {
    const html = renderToStaticMarkup(<StoreHeaderCard tenant={tenant} isOpen={false} canToggleOpen={false} />);
    expect(html).toContain('Loja fechada');
    expect(html).not.toContain('data-testid="toggle-store-open"');
    expect(html).not.toContain('Banners');
  });
});
