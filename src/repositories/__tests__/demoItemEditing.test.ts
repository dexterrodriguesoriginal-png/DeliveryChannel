import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  row: { id: '20000000-0000-4000-8000-000000000002', tenant_id: '20000000-0000-4000-8000-000000000001', is_demo: false },
}));
vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: backend.from },
}));

import { categoryRepository } from '../categoryRepository';
import { productRepository } from '../productRepository';
import { offerRepository } from '../offerRepository';

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    update: backend.update,
    eq: backend.eq,
    select: () => query,
    single: async () => ({ data: backend.row, error: null }),
    maybeSingle: async () => ({ data: backend.row, error: null }),
  };
  backend.from.mockReturnValue(query);
  backend.update.mockReturnValue(query);
  backend.eq.mockReturnValue(query);
});

describe('edição de itens de demonstração', () => {
  it.each([
    ['categories', categoryRepository, { name: 'Categoria própria' }],
    ['products', productRepository, { name: 'Produto próprio', price: 19.9 }],
    ['offers', offerRepository, { title: 'Oferta própria' }],
  ] as const)('ao editar %s persiste is_demo=false e mantém o filtro do tenant', async (table, repository, updates) => {
    const saved = await repository.update({} as any, backend.row.tenant_id, backend.row.id, { ...updates, isDemo: true });
    expect(backend.from).toHaveBeenCalledWith(table);
    expect(backend.update).toHaveBeenCalledWith(expect.objectContaining({ is_demo: false }));
    expect(backend.eq).toHaveBeenCalledWith('tenant_id', backend.row.tenant_id);
    expect(backend.eq).toHaveBeenCalledWith('id', backend.row.id);
    expect(saved.isDemo).toBe(false);
  });
});
