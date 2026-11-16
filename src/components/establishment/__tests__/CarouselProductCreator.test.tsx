// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const create = vi.hoisted(() => vi.fn());
vi.mock('../../../repositories/promotionRepository', () => ({ promotionRepository: { createPromotionalProduct: create } }));
import { CarouselProductCreator } from '../CarouselProductCreator';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('cadastro promocional', () => {
  it('salva produto, validade e componentes como um kit sem adicionar ao catálogo', async () => {
    const onSaved = vi.fn(); create.mockResolvedValue({ id: 'carousel', items: [] });
    render(<CarouselProductCreator tenantId="loja" carouselId="carousel" products={[{ id: 'component', name: 'Suco' } as never]} onSaved={onSaved} />);
    for (const [label, value] of [ ['Foto (URL)', 'https://example.com/foto.png'], ['Nome', 'Kit'], ['Preço promocional', '12'], ['Válido até', '2099-01-01T10:00'], ['Estoque de unidades ou kits', '5'], ['Quantidade de Suco por kit', '2'] ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Criar produto promocional' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('loja', 'carousel', expect.objectContaining({ name: 'Kit', price: 12, stock: 5, originalPrice: undefined }), [{ productId: 'component', quantity: 2 }]));
    expect(onSaved).toHaveBeenCalledWith({ id: 'carousel', items: [] });
  });
});
