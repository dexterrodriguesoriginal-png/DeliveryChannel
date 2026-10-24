import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() }, isSupabaseConfigured: true }));
import { supabase } from '../../lib/supabase';
import { demoPackService } from '../demoPackService';

const rpc = vi.mocked(supabase.rpc);
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { success: true }, error: null } as any); });

describe('demoPackService usa apenas RPCs com tenant derivado no servidor', () => {
  it('seed envia somente segmento', async () => {
    await demoPackService.seedDemoPack('pizzaria');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('seed_demo_pack', { p_segment: 'pizzaria' });
  });

  it('manter finaliza sem parâmetro de tenant', async () => {
    await demoPackService.keepDemoItems();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('keep_demo_items');
  });

  it.each([null, [], ['id-1']])('remoção envia só IDs: %j', async ids => {
    await demoPackService.removeDemoItems(ids);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('remove_demo_items', { p_ids: ids });
  });

  it('carrega revisão e valida sua resposta antes de habilitar ações', async () => {
    const review = { tenantId: 't1', reviewed: false, items: [{ id: 'p1', kind: 'product', name: 'Pizza' }] };
    rpc.mockResolvedValueOnce({ data: review, error: null } as any);
    expect(await demoPackService.getReview()).toEqual(review);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_demo_pack_review');
    rpc.mockResolvedValueOnce({ data: { reviewed: false, items: [] }, error: null } as any);
    await expect(demoPackService.getReview()).rejects.toThrow('Não foi possível confirmar');
  });

  it('erro do servidor impede confirmar manutenção ou remoção', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Sem permissão', code: '42501' } } as any);
    await expect(demoPackService.keepDemoItems()).rejects.toThrow('Sem permissão');
    await expect(demoPackService.removeDemoItems()).rejects.toThrow('Sem permissão');
  });
});
