import { describe, it, expect } from 'vitest';
import { readTrackingDeepLink, trackingUrlFor } from '../trackingDeepLink';

const ID = '3f2b8c1e-2a4d-4c6b-9e1f-0a1b2c3d4e5f';

describe('deep link do acompanhamento', () => {
  it('lê #pedidos e ?pedido=<uuid>', () => {
    expect(readTrackingDeepLink('', '#pedidos')).toEqual({ open: true, orderId: undefined });
    expect(readTrackingDeepLink(`?pedido=${ID}`, '')).toEqual({ open: true, orderId: ID });
    expect(readTrackingDeepLink('?pedido=nao-e-uuid', '')).toEqual({ open: false, orderId: undefined });
    expect(readTrackingDeepLink('?product=1', '#access_token=x')).toEqual({ open: false, orderId: undefined });
  });
  it('grava #pedidos ao abrir a aba e limpa ao sair', () => {
    expect(trackingUrlFor('https://x.ai/app/loja', true)).toBe('https://x.ai/app/loja#pedidos');
    expect(trackingUrlFor('https://x.ai/app/loja#pedidos', true)).toBeNull();
    expect(trackingUrlFor(`https://x.ai/app/loja?pedido=${ID}&utm=a#pedidos`, false)).toBe('https://x.ai/app/loja?utm=a');
    expect(trackingUrlFor('https://x.ai/app/loja', false)).toBeNull();
  });
  it('não mexe em outro hash (retorno do OAuth)', () => {
    expect(trackingUrlFor('https://x.ai/app/loja#access_token=abc', true)).toBeNull();
    expect(trackingUrlFor('https://x.ai/app/loja#access_token=abc', false)).toBeNull();
  });
});
