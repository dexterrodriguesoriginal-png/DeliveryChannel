import { describe, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ data: [
  { id: 'normal', name: 'Catálogo', price: 10, stock_quantity: 2, is_active: true, carousel_only: false },
  { id: 'exclusive', name: 'Só promoção', price: 8, stock_quantity: 2, is_active: true, carousel_only: true },
] }));
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: fixture.data, error: null }) }) }) }) },
}));
import { productRepository } from '../productRepository';

describe('Cardápio/Produtos do painel', () => {
  it('não lista SKUs exclusivos do carrossel mesmo quando a RLS permite ao dono lê-los', async () => {
    const result = await productRepository.getProducts({} as never, '10000000-0000-4000-8000-000000000001');
    expect(result.map(p => p.id)).toEqual(['normal']);
  });
});
