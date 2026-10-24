import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transport, accessToken } = vi.hoisted(() => ({
  transport: vi.fn(), accessToken: vi.fn(),
}));
vi.mock('../../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://offline.supabase.co', 'test-public-key', {
      accessToken,
      global: { fetch: transport },
      realtime: { transport: class {} as never },
    }),
  };
});
import { feedbackRepository } from '../feedbackRepository';

const input = { type: 'sugestao' as const, message: '  Mais opções no cardápio.  ' };
beforeEach(() => {
  accessToken.mockReset().mockResolvedValue(null);
  transport.mockReset().mockImplementation(async () => new Response(null, { status: 204 }));
});

describe('feedback v2 through real supabase-js transport (offline)', () => {
  it.each([null, 'signed-session-jwt'])('sends with the SDK credentials for %s', async (token) => {
    accessToken.mockResolvedValue(token);
    await feedbackRepository.submit('loja-a', {
      ...input, tenant_id: 'spoof', sender_hash: 'spoof', user_id: 'spoof', day: 'spoof',
    } as typeof input);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe('https://offline.supabase.co/rest/v1/rpc/submit_store_feedback_v2');
    expect(options.method).toBe('POST');
    expect(new Headers(options.headers).get('apikey')).toBe('test-public-key');
    expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${token ?? 'test-public-key'}`);
    expect(JSON.parse(options.body)).toEqual({
      p_tenant_slug_or_id: 'loja-a', p_type: 'sugestao', p_area: null,
      p_rating: null, p_message: 'Mais opções no cardápio.',
    });
  });

  it('accepts a UUID destination and optional area/rating without adding identity fields', async () => {
    const id = '10000000-0000-0000-0000-00000000000a';
    await feedbackRepository.submit(id, { ...input, area: 'entrega', rating: 1 });
    expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({
      p_tenant_slug_or_id: id, p_area: 'entrega', p_rating: 1,
    });
  });

  it.each([
    { ...input, type: 'unknown' }, { ...input, area: 'unknown' },
    { ...input, rating: 0 }, { ...input, rating: 6 }, { ...input, rating: 1.5 },
    { ...input, message: 'x'.repeat(9) }, { ...input, message: 'x'.repeat(1001) },
  ])('rejects invalid form values before any network request: %j', async (value) => {
    await expect(feedbackRepository.submit('loja-a', value as any)).rejects.toThrow('Confira');
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([10, 1000])('allows a message of %i Unicode code points', async (length) => {
    await feedbackRepository.submit('loja-a', { ...input, message: '😀'.repeat(length) });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['P0001', 400, 'Limite diário de 5'],
    ['22023', 400, 'Confira os campos'],
    ['PGRST301', 401, 'Não foi possível enviar'],
    ['42501', 403, 'Não foi possível enviar'],
    ['XX000', 500, 'Não foi possível enviar'],
  ])('handles %s without exposing database details', async (code, status, message) => {
    transport.mockImplementation(async () => new Response(JSON.stringify({
      code, message: 'private secret/hash/IP', details: 'private details', hint: 'private hint',
    }), { status, headers: { 'Content-Type': 'application/json' } }));
    await expect(feedbackRepository.submit('loja-a', input)).rejects.toThrow(message);
    await expect(feedbackRepository.submit('loja-a', input)).rejects.not.toThrow('private');
  });

  it('fails on network errors without simulating success or using a fallback route', async () => {
    transport.mockRejectedValue(new Error('private network details'));
    await expect(feedbackRepository.submit('loja-a', input)).rejects.toThrow('Não foi possível enviar');
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
