import { describe, expect, it, vi } from 'vitest';
import { clearDeviceSessionStorage, signOutSupabaseSession } from '../deviceLogout';

describe('logout do PWA do entregador', () => {
  it('remove chaves de autenticação e tenant, preservando dados alheios, inclusive após F5', () => {
    const stored = new Map([
      ['adegafood_pref_tenant_user1', 'loja-a'],
      ['deliverychannel_driver_location_consent', 'ACCEPTED'],
      ['sb-auth-token', 'token'],
      ['other_unrelated_key', 'preserve_me'],
    ]);
    const local = {
      get length() { return stored.size; },
      key: (index: number) => [...stored.keys()][index] ?? null,
      removeItem: (key: string) => { stored.delete(key); },
    };
    const session = { clear: vi.fn() };
    clearDeviceSessionStorage(local, session);
    expect(stored.has('adegafood_pref_tenant_user1')).toBe(false);
    expect(stored.has('deliverychannel_driver_location_consent')).toBe(false);
    expect(stored.has('sb-auth-token')).toBe(false);
    expect(stored.get('other_unrelated_key')).toBe('preserve_me');
    expect(session.clear).toHaveBeenCalledOnce();
  });

  it('entregador encerra a sessão apenas neste dispositivo', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await signOutSupabaseSession({ signOut }, 'local');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('logout oficial dos outros papéis preserva escopo global', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await signOutSupabaseSession({ signOut }, 'global');
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });
});


describe('ordem e falhas da revogação', () => {
  it('mantém o token até a revogação terminar e só então limpa o dispositivo', async () => {
    let token: string | null = 'token';
    let finish!: () => void;
    const signOut = vi.fn(async () => {
      expect(token).toBe('token');
      await new Promise<void>(resolve => { finish = resolve; });
      expect(token).toBe('token');
      return { error: null };
    });
    const pending = signOutSupabaseSession({ signOut }, 'local', () => { token = null; });
    expect(token).toBe('token');
    finish();
    await pending;
    expect(token).toBeNull();
  });

  it.each(['rejection', 'returned error'])('limpa dados locais mesmo com %s', async failure => {
    const error = new Error('offline');
    const clear = vi.fn();
    const signOut = failure === 'rejection'
      ? vi.fn().mockRejectedValue(error)
      : vi.fn().mockResolvedValue({ error });
    await expect(signOutSupabaseSession({ signOut }, 'local', clear)).rejects.toThrow('offline');
    expect(clear).toHaveBeenCalledOnce();
  });
});
