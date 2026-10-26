import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
import { dispatchChatRepository as repo } from '../dispatchChatRepository';
import { handoffRepository } from '../handoffRepository';
describe('PR B server-authoritative operations', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { success: true },error: null }); });
  it('requests a tenant-scoped queue and saves only the selected mode', async () => {
    await repo.queue('B'); expect(rpc).toHaveBeenLastCalledWith('get_dispatch_queue',{ p_tenant_id: 'B' });
    await repo.setMode('B','AUTO_QUEUE'); expect(rpc).toHaveBeenLastCalledWith('set_dispatch_mode',{ p_tenant_id: 'B',p_mode: 'AUTO_QUEUE' });
  });
  it('never accepts caller-supplied sender, role or tenant in chat sends', async () => {
    await repo.send('order-B','Já cheguei.'); expect(rpc).toHaveBeenLastCalledWith('send_order_message',{ p_order_id: 'order-B',p_body: 'Já cheguei.' });
  });
  it('resets either handoff kind without retrieving the replacement code for staff', async () => {
    await handoffRepository.reset('order-B','delivery'); expect(rpc).toHaveBeenLastCalledWith('reset_handoff_code',{ p_order_id: 'order-B',p_kind: 'delivery' });
  });
  it('does not expose raw backend errors or identifiers to chat users', async () => {
    rpc.mockResolvedValue({ data: null,error: { message: 'internal db credential personal@example.test' } });
    await expect(repo.send('o','msg')).rejects.toThrow('Não foi possível concluir. Tente de novo.');
  });
});
