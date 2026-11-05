import { beforeEach, describe, expect, it, vi } from 'vitest';
const { updateStatus } = vi.hoisted(() => ({ updateStatus: vi.fn() }));
vi.mock('../orderRepository', () => ({ orderRepository: { updateStatus } }));
import { acceptOrderForProduction } from '../orderProduction';
import type { SecurityContext } from '../../services/securityEngine';
const context: SecurityContext = { userId: 'staff-a', userName: 'Caixa', userRole: 'CASHIER' };

beforeEach(() => {
  updateStatus.mockReset();
  updateStatus.mockImplementation(async (_context, tenantId, id, status) => ({ id, tenantId, status }));
});
describe('aceitar pedido e iniciar produção', () => {
  it('preserva as etapas adjacentes autorizadas para caixa e retorna o pedido em produção', async () => {
    const result = await acceptOrderForProduction(context, 'A', { id: 'order-a', tenantId: 'A', status: 'PENDING' });
    expect(updateStatus.mock.calls.map(call => [call[3], call[5]])).toEqual([['CONFIRMED', 'PENDING'], ['PREPARING', 'CONFIRMED']]);
    expect(result.status).toBe('PREPARING');
  });
  it('não repete aceite quando a rodada já chega confirmada', async () => {
    await acceptOrderForProduction(context, 'A', { id: 'round-a', tenantId: 'A', status: 'CONFIRMED' });
    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith(context, 'A', 'round-a', 'PREPARING', undefined, 'CONFIRMED');
  });
  it('recusa pedido de outra loja, encerrado ou sem resposta de aceite consistente', async () => {
    await expect(acceptOrderForProduction(context, 'A', { id: 'other', tenantId: 'B', status: 'PENDING' })).rejects.toThrow();
    await expect(acceptOrderForProduction(context, 'A', { id: 'closed', tenantId: 'A', status: 'DELIVERED' })).rejects.toThrow();
    expect(updateStatus).not.toHaveBeenCalled();
    updateStatus.mockResolvedValueOnce({ id: 'order-a', tenantId: 'B', status: 'CONFIRMED' });
    await expect(acceptOrderForProduction(context, 'A', { id: 'order-a', tenantId: 'A', status: 'PENDING' })).rejects.toThrow('O pedido mudou');
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });
  it('não avança produção quando o aceite foi recusado pelo servidor', async () => {
    updateStatus.mockRejectedValueOnce(new Error('Permissão revogada'));
    await expect(acceptOrderForProduction(context, 'A', { id: 'order-a', tenantId: 'A', status: 'PENDING' })).rejects.toThrow();
    expect(updateStatus).toHaveBeenCalledTimes(1);
  });
});

