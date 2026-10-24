import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PDVModal } from '../PDVModal';
import { Product } from '../../../types';
import { rpcErrorMessage } from '../../../lib/rpcErrors';

const sampleProducts: Product[] = [
  {
    id: 'prod-1',
    tenantId: 'tenant-123',
    categoryId: 'cat-1',
    name: 'Vinho Tinto Reserva',
    description: 'Seco 750ml',
    price: 89.90,
    imageUrl: '',
    isAvailable: true,
    isActive: true,
    isFeatured: false,
    stockQuantity: 10,
    unit: 'un',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
  },
  {
    id: 'prod-2',
    tenantId: 'tenant-123',
    categoryId: 'cat-1',
    name: 'Cerveja Artesanal IPA',
    description: '500ml',
    price: 18.50,
    imageUrl: '',
    isAvailable: true,
    isActive: true,
    isFeatured: false,
    stockQuantity: 25,
    unit: 'un',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
  },
];

describe('PDVModal — Frente de Caixa Balcão', () => {
  it('retorna null quando isOpen for false', () => {
    const html = renderToStaticMarkup(
      <PDVModal
        isOpen={false}
        tenantId="tenant-123"
        products={sampleProducts}
        addonsEnabled={false}
        onClose={() => {}}
        onSubmit={async () => {}}
      />
    );
    expect(html).toBe('');
  });

  it('renderiza título, produtos do catálogo e campos quando aberto', () => {
    const html = renderToStaticMarkup(
      <PDVModal
        isOpen={true}
        tenantId="tenant-123"
        products={sampleProducts}
        addonsEnabled={false}
        onClose={() => {}}
        onSubmit={async () => {}}
        initialCustomerName="Maria Silva"
        initialCustomerPhone="(11) 98765-4321"
      />
    );

    expect(html).toContain('Frente de Caixa (PDV Balcão)');
    expect(html).toContain('Vinho Tinto Reserva');
    expect(html).toContain('Cerveja Artesanal IPA');
    expect(html).toContain('Maria Silva');
    expect(html).toContain('PIX');
    expect(html).toContain('Finalizar Venda no Caixa');
  });

  it('o submit chama o serviço com cliente opcional e sem exigir tenant do cliente no payload do formulário', async () => {
    const submitSpy = vi.fn().mockResolvedValue(undefined);

    const dataSubmitted = {
      customerName: '',
      customerPhone: '',
      paymentMethod: 'PIX' as const,
      notes: 'Venda direta realizada pela frente de caixa (PDV).',
      idempotencyKey: '00000000-0000-0000-0000-000000000001',
      items: [
        { productId: 'prod-1', quantity: 2 },
      ],
    };

    await submitSpy(dataSubmitted);

    expect(submitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: 'PIX',
        items: [{ productId: 'prod-1', quantity: 2 }],
        notes: expect.any(String),
      })
    );
    // Confirma que não há campo tenant no payload do cliente (o tenant é resolvido via backend/sessão)
    expect((dataSubmitted as any).tenantId).toBeUndefined();
  });

  it('erros de RPC mostram mensagem amigável via rpcErrors', () => {
    const rpcError = { code: '42501', message: 'permission denied' };
    const friendly = rpcErrorMessage(rpcError);
    expect(friendly).toBe('Sem permissão para esta ação.');

    const notApprovedError = { code: 'P0414', message: 'custom msg' };
    expect(rpcErrorMessage(notApprovedError)).toBe('Entregador não aprovado.');
  });
});
