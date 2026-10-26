// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { TemplateGallery, TemplateGalleryProps } from '../TemplateGallery';
import { TEMPLATES, findClosestTemplate, filterTemplates } from '../../../../lib/theme/templates';
import { tokensToTheme, themeToTokens } from '../../../../lib/theme/themeEngine';

import { extractLogoPalette } from '../../../../lib/theme/extractLogoPalette';
vi.mock('../../../../lib/theme/extractLogoPalette', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/theme/extractLogoPalette')>()),
  extractLogoPalette: vi.fn().mockResolvedValue([]),
}));
const model = TEMPLATES[0];
const identity = {
  storeName: 'Minha Loja Real',
  tagline: 'Feito aqui',
  logoUrl: 'https://example.com/logo.png',
  bannerUrl: 'https://example.com/capa.png',
};
const theme = tokensToTheme(model.tokens, identity);
function gallery(props: Partial<TemplateGalleryProps> = {}) {
  return (
    <TemplateGallery
      tenantId="tenant-1"
      savedTheme={theme}
      draftTheme={theme}
      onApply={vi.fn()}
      {...props}
    />
  );
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('galeria de modelos', () => {
  it('pré-seleciona o segmento e combina padaria + azul', () => {
    render(gallery({ category: 'padaria' }));
    expect((screen.getByLabelText('Meu estabelecimento') as HTMLSelectElement).value).toBe(
      'padaria'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Azul' }));
    expect(screen.getAllByTestId('template-card').length).toBeGreaterThanOrEqual(1);
    for (const card of screen.getAllByTestId('template-card'))
      expect(card.getAttribute('data-template-id')).toContain('padaria');
    fireEvent.change(screen.getByLabelText('Meu estilo'), { target: { value: 'escuro' } });
    for (const card of screen.getAllByTestId('template-card'))
      expect(card.textContent).toContain('Escuro');
  });
  it('limpa todos os filtros, conta 150 e pagina de 24 em 24', () => {
    render(gallery({ category: 'padaria' }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByRole('status').textContent).toBe('150 modelos');
    expect(screen.getAllByTestId('template-card')).toHaveLength(24);
    fireEvent.click(screen.getByRole('button', { name: /Ver mais/ }));
    expect(screen.getAllByTestId('template-card')).toHaveLength(48);
    expect(
      (screen.getByLabelText('Meu estabelecimento') as HTMLSelectElement).options
    ).toHaveLength(26);
  });
  it('persiste favoritos no localStorage e isola por estabelecimento', () => {
    const view = render(gallery());
    fireEvent.click(screen.getByRole('button', { name: `Favoritar ${model.name}` }));
    expect(JSON.parse(localStorage.getItem('dc:theme-favs:tenant-1')!)).toEqual([model.id]);
    view.unmount();
    const second = render(gallery());
    expect(
      screen
        .getByRole('button', { name: `Desfavoritar ${model.name}` })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Só favoritos/ }));
    expect(screen.getAllByTestId('template-card')).toHaveLength(1);
    second.rerender(gallery({ tenantId: 'tenant-2' }));
    expect(screen.queryAllByTestId('template-card')).toHaveLength(0);
    expect(localStorage.getItem('dc:theme-favs:tenant-2')).toBeNull();
  });
  it('marca o modelo salvo como Tema atual e reconhece temas antigos', () => {
    const view = render(gallery());
    expect(within(screen.getAllByTestId('template-card')[0]).getByText('Tema atual')).toBeTruthy();
    const legacy = { ...theme, tokens: undefined };
    const closest = findClosestTemplate(themeToTokens(legacy));
    view.rerender(gallery({ savedTheme: legacy, draftTheme: legacy }));
    fireEvent.change(screen.getByLabelText('Meu estabelecimento'), {
      target: { value: closest.segmentId },
    });
    const card = screen
      .getAllByTestId('template-card')
      .find((card) => card.getAttribute('data-template-id') === closest.id)!;
    expect(within(card).getByText('Tema atual')).toBeTruthy();
  });
  it('selecionar dois modelos abre comparação com identidade e produtos reais', () => {
    const onApply = vi.fn();
    render(
      gallery({
        onApply,
        products: [
          {
            id: 'real-1',
            name: 'Produto da minha loja',
            price: 18,
            imageUrl: 'https://example.com/produto.png',
          },
        ],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: `Comparar ${model.name}` }));
    fireEvent.click(screen.getByRole('button', { name: `Comparar ${TEMPLATES[1].name}` }));
    const dialog = screen.getByRole('dialog', { name: 'Compare na sua loja' });
    expect(within(dialog).getAllByText('Minha Loja Real')).toHaveLength(2);
    expect(within(dialog).getAllByText('Produto da minha loja')).toHaveLength(2);
    expect(
      within(dialog)
        .getAllByRole('img', { name: 'Minha Loja Real' })
        .every((img) => img.getAttribute('src') === identity.logoUrl)
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: `Comparar ${TEMPLATES[2].name}` }).hasAttribute('disabled')
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: `Usar este: ${model.name}` }));
    expect(onApply).toHaveBeenCalledWith(model);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('prévia não aplica sozinha; usa exemplos do segmento se a loja não tiver produtos', () => {
    const onApply = vi.fn();
    render(gallery({ category: 'padaria', onApply }));
    fireEvent.click(screen.getAllByRole('button', { name: /Ver na minha loja/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Veja na sua loja' });
    expect(within(dialog).getByText('Minha Loja Real')).toBeTruthy();
    expect(within(dialog).getByText('Pão Francês Tradicional (kg)')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
  it('não renderiza linguagem técnica proibida e tolera favoritos corrompidos', () => {
    localStorage.setItem('dc:theme-favs:tenant-1', '{invalid');
    const { container } = render(gallery());
    expect(container.textContent).not.toMatch(/tokens CSS|homologad|semântica/i);
    expect(screen.getByRole('status').textContent).toBe('150 modelos');
  });
});

it('favoritos de variações recoloridas reaparecem depois de recarregar', () => {
  const variant = filterTemplates({ segment: 'adega', colorFamily: 'azul', style: 'artesanal' })[0];
  localStorage.setItem('dc:theme-favs:tenant-1', JSON.stringify([variant.id]));
  render(gallery());
  fireEvent.click(screen.getByRole('button', { name: /Só favoritos/ }));
  expect(screen.getAllByTestId('template-card')).toHaveLength(1);
  expect(screen.getAllByTestId('template-card')[0].getAttribute('data-template-id')).toBe(
    variant.id
  );
});

it('sugere pela logo e permite filtrar pelas cores extraídas', async () => {
  vi.mocked(extractLogoPalette).mockResolvedValueOnce(['#0369a1', '#15803d', '#db2777']);
  render(gallery());
  fireEvent.click(screen.getByRole('button', { name: 'Sugerir pela minha logo' }));
  await waitFor(() => expect(screen.getByText('Cores da sua logo')).toBeTruthy());
  expect(extractLogoPalette).toHaveBeenCalledWith(identity.logoUrl);
  fireEvent.click(screen.getByRole('button', { name: /Filtrar azul da logo/ }));
  expect(screen.getByRole('button', { name: 'Azul' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getAllByTestId('template-card').length).toBeGreaterThan(0);
});
