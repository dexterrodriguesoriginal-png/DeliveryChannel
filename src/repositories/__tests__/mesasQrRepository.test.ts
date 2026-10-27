import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) }, isSupabaseConfigured: true }));

import { isMissingSchemaError, mesasQrRepository, NO_CAPABILITIES, parseCapabilities } from '../mesasQrRepository';

beforeEach(() => { rpc.mockReset(); from.mockReset(); });

describe('mesasQrRepository — degrada sem a migração', () => {
  it('parseCapabilities só liga o que o banco declara', () => {
    expect(parseCapabilities(null)).toEqual(NO_CAPABILITIES);
    expect(parseCapabilities({ version: 0, qr_pause: true })).toEqual(NO_CAPABILITIES);
    expect(parseCapabilities({ version: 1, qr_pause: true, tab_pix: false })).toEqual({ available: true, qrPause: true, tabPix: false });
    expect(parseCapabilities({ version: 1, qr_pause: 'yes', tab_pix: 1 })).toEqual({ available: true, qrPause: false, tabPix: false });
  });
  it('capabilities() nunca lança: função ausente, erro de rede ou exceção = recurso desligado', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await mesasQrRepository.capabilities()).toEqual(NO_CAPABILITIES);
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await mesasQrRepository.capabilities()).toEqual(NO_CAPABILITIES);
    rpc.mockResolvedValueOnce({ data: { version: 1, qr_pause: true, tab_pix: true }, error: null });
    expect(await mesasQrRepository.capabilities()).toEqual({ available: true, qrPause: true, tabPix: true });
  });
  it('pauses() devolve vazio quando a tabela ainda não existe e propaga outros erros', async () => {
    const chain = (result: unknown) => ({ select: () => ({ eq: () => Promise.resolve(result) }) });
    from.mockReturnValueOnce(chain({ data: null, error: { code: '42P01', message: 'relation "dining_qr_pauses" does not exist' } }));
    expect(await mesasQrRepository.pauses('t1')).toEqual({ storeWide: false, tableIds: [] });
    from.mockReturnValueOnce(chain({ data: [{ table_id: null }, { table_id: 'a' }], error: null }));
    expect(await mesasQrRepository.pauses('t1')).toEqual({ storeWide: true, tableIds: ['a'] });
    from.mockReturnValueOnce(chain({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(mesasQrRepository.pauses('t1')).rejects.toBeTruthy();
  });
  it('pixReviews() ignora falhas e lista vazia não consulta o banco', async () => {
    expect((await mesasQrRepository.pixReviews('t1', [])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
    from.mockReturnValueOnce({ select: () => ({ eq: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'x' } }) }) }) }) });
    expect((await mesasQrRepository.pixReviews('t1', ['a'])).size).toBe(0);
  });
  it('setPause envia só tenant, mesa e flag para o RPC protegido', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await mesasQrRepository.setPause('t1', null, true);
    expect(rpc).toHaveBeenCalledWith('set_dining_qr_pause', { p_tenant: 't1', p_table: null, p_paused: true });
  });
  it('reconhece erros de esquema ausente', () => {
    expect(isMissingSchemaError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingSchemaError({ message: 'Could not find the table public.x in the schema cache' })).toBe(true);
    expect(isMissingSchemaError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
});
