import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoBadge } from '../../common/DemoBadge';
import { CatalogOffersSection } from '../CatalogOffersSection';
import type { Offer } from '../../../types';

describe('selo Demo', () => {
  it('identifica itens de demonstração e explica a personalização', () => {
    const html = renderToStaticMarkup(<DemoBadge isDemo />);
    expect(html).toContain('>Demo</span>');
    expect(html).toContain('Ao editar, ele passa a fazer parte do seu catálogo.');
  });

  it.each([false, undefined])('oculta o selo em itens próprios (%s)', isDemo => {
    expect(renderToStaticMarkup(<DemoBadge isDemo={isDemo} />)).toBe('');
  });
});

const offer = (id: string, isDemo: boolean): Offer => ({
  id,
  tenantId: 'loja',
  title: `Oferta ${id}`,
  description: 'Descrição da oferta',
  originalPrice: 40,
  promotionalPrice: 35,
  order: 1,
  isActive: true,
  isDemo,
});

describe('cards de oferta no painel de promoções', () => {
  it('mostra o selo somente nas ofertas demo, mantendo os cards próprios visíveis', () => {
    const html = renderToStaticMarkup(<CatalogOffersSection offers={[offer('demo', true), offer('propria', false)]} canManage onEdit={() => {}} />);
    expect(html).toContain('Oferta demo');
    expect(html).toContain('Oferta propria');
    expect(html.match(/>Demo<\/span>/g)).toHaveLength(1);
    expect(html.match(/Editar oferta/g)).toHaveLength(2);
  });

  it('oculta ações de edição para quem não pode gerenciar promoções', () => {
    const html = renderToStaticMarkup(<CatalogOffersSection offers={[offer('demo', true)]} canManage={false} onEdit={() => {}} />);
    expect(html).not.toContain('Editar oferta');
  });
});
