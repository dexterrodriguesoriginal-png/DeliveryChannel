import { describe, expect, it, vi } from 'vitest';
import { PaymentStore } from '../store';

describe('erros claros sem exposição de detalhes do banco', () => {
  it.each([
    ['Conta não conectada.', 'ACCOUNT_NOT_CONNECTED', 'Conecte esta conta'],
    ['Conexão expirada; inicie novamente.', 'CONNECTION_EXPIRED', 'A conexão expirou'],
    ['Conexão alterada; conecte novamente.', 'RECONNECT_REQUIRED', 'A conexão mudou'],
    ['Configure a chave PIX da loja.', 'PIX_SETTINGS_REQUIRED', 'Cadastre e ative'],
    ['Pedido não aceita confirmação.', 'ORDER_NOT_CONFIRMABLE', 'Atualize o pedido'],
    ['Aguarde os pagamentos pendentes antes de desconectar.', 'PENDING_PAYMENTS', 'pagamentos em aberto'],
  ])('%s recebe orientação específica', async (message, code, text) => {
    const store = new PaymentStore({ rpc: vi.fn().mockResolvedValue({ error: { code: 'P0001', message } }) } as any);
    await expect(store.rpc('configure_store_payment', {})).rejects.toMatchObject({ code, message: expect.stringContaining(text) });
  });
  it('não reflete erros desconhecidos, constraints ou informações privadas', async () => {
    const store = new PaymentStore({ rpc: vi.fn().mockResolvedValue({ error: { code: '23514', message: 'token=SECRET private@example.com', details: 'PRIVATE' } }) } as any);
    await expect(store.rpc('configure_store_payment', {})).rejects.toMatchObject({ code: 'PAYMENT_STORAGE_ERROR', message: 'Não foi possível salvar a alteração. Atualize a página e tente novamente.' });
  });
});
