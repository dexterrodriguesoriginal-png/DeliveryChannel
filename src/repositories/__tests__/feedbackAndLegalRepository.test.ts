import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, getSession } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc, auth: { getSession } },
}));
import { feedbackRepository } from '../feedbackRepository';
import { legalRepository } from '../legalRepository';
import { LEGAL_VERSION } from '../../lib/legal/documents';
beforeEach(() => {
  vi.unstubAllGlobals();
  rpc.mockReset();
  getSession
    .mockReset()
    .mockResolvedValue({ data: { session: null }, error: null });
});
describe('feedback repository', () => {
  it('uses only the server endpoint to submit, including a JWT when logged in', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetcher);
    getSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
    });
    await feedbackRepository.submit('store-a', {
      type: 'elogio',
      area: null,
      rating: 5,
      message: 'Excelente atendimento!',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/store-feedback/store-a',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it('propagates rate-limit failures without reporting success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          json: async () => ({ message: 'Limite diário' }),
        }),
    );
    await expect(
      feedbackRepository.submit('store-a', {
        type: 'elogio',
        area: null,
        rating: null,
        message: 'Excelente atendimento!',
      }),
    ).rejects.toThrow('Limite diário');
  });
  it('requests the selected page with filters and no client tenant UUID', async () => {
    const result = { rows: [], stats: { total: 0 } };
    rpc.mockResolvedValue({ data: result });
    expect(
      await feedbackRepository.list('store-a', {
        type: 'elogio',
        area: 'app',
        from: '2026-10-01',
        to: '2026-10-24',
        state: 'unread',
        offset: 50,
      }),
    ).toBe(result);
    expect(rpc).toHaveBeenCalledWith('list_store_feedback', {
      p_store_slug: 'store-a',
      p_type: 'elogio',
      p_area: 'app',
      p_from: '2026-10-01',
      p_to: '2026-10-24',
      p_state: 'unread',
      p_offset: 50,
    });
  });
  it('does not invent data on read errors', async () => {
    rpc.mockResolvedValue({ error: { message: 'denied' } });
    await expect(feedbackRepository.list('other-store')).rejects.toThrow();
  });
  it('changes store-only state by authorized RPC', async () => {
    rpc.mockResolvedValue({});
    await feedbackRepository.setState(
      'store-a',
      { id: 'id' } as any,
      true,
      false,
    );
    expect(rpc).toHaveBeenCalledWith('set_store_feedback_state', {
      p_store_slug: 'store-a',
      p_id: 'id',
      p_read: true,
      p_archived: false,
    });
  });
});
describe('legal repository', () => {
  it('records the current document version without taking a user or tenant identifier', async () => {
    rpc.mockResolvedValue({});
    await legalRepository.accept('customer');
    expect(rpc).toHaveBeenCalledWith('accept_current_legal', {
      p_audience: 'customer',
      p_version: LEGAL_VERSION,
    });
  });
  it('requires a valid server status', async () => {
    rpc.mockResolvedValue({ data: null });
    await expect(legalRepository.status('owner')).rejects.toThrow();
  });
  it('propagates refusal of outdated acceptance', async () => {
    rpc.mockResolvedValue({ error: { code: '22023' } });
    await expect(legalRepository.accept('customer')).rejects.toThrow();
  });
  it('exports only through the self-scoped RPC', async () => {
    rpc.mockResolvedValue({ data: { profile: { name: 'Customer' } } });
    expect(await legalRepository.exportMyData()).toEqual({
      profile: { name: 'Customer' },
    });
    expect(rpc).toHaveBeenCalledWith('export_my_customer_data');
  });
});
