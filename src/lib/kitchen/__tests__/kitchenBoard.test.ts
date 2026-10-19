import { describe, it, expect } from 'vitest';
import { kitchenNextAction, kitchenColumns, minutesInStage, lateLevel, kitchenOrderLabel, normalizePairCode, formatPairCode, pairCodeFromHash, pairUrl, secondsLeft, isKitchenMissing, kitchenErrorMessage, newReadyIds } from '../kitchenBoard';

const o = (id: string, status: any, extra: any = {}) => ({ order_id: id, order_number: 1, status, fulfillment_type: 'DELIVERY', created_at: '2026-10-19T10:00:00Z', items: [], ...extra });
describe('kitchenBoard', () => {
  it('só CONFIRMED→PREPARING e PREPARING→READY', () => {
    expect(kitchenNextAction('CONFIRMED')?.to).toBe('PREPARING');
    expect(kitchenNextAction('PREPARING')?.to).toBe('READY');
    for (const s of ['PENDING', 'READY', 'WAITING_FOR_DRIVER', 'DELIVERED', 'CANCELED']) expect(kitchenNextAction(s)).toBeNull();
  });
  it('colunas ordenadas pela confirmação', () => {
    const c = kitchenColumns([o('b', 'CONFIRMED', { confirmed_at: '2026-10-19T10:05:00Z' }), o('a', 'CONFIRMED', { confirmed_at: '2026-10-19T10:01:00Z' }), o('p', 'PREPARING')] as any);
    expect(c.toDo.map(x => x.order_id)).toEqual(['a', 'b']); expect(c.doing.map(x => x.order_id)).toEqual(['p']);
  });
  it('tempo na etapa e atraso', () => {
    const now = new Date('2026-10-19T10:12:00Z').getTime();
    expect(minutesInStage(o('a', 'PREPARING', { preparing_at: '2026-10-19T10:02:00Z' }) as any, now)).toBe(10);
    expect(lateLevel(5)).toBe('ok'); expect(lateLevel(10)).toBe('warn'); expect(lateLevel(25)).toBe('late');
  });
  it('rótulo: retirada mostra só o primeiro nome', () => {
    expect(kitchenOrderLabel({ fulfillment_type: 'PICKUP', customer_first_name: 'Maria' })).toBe('Retirada · Maria');
    expect(kitchenOrderLabel({ fulfillment_type: 'DELIVERY', customer_first_name: null })).toBe('Entrega');
  });
  it('código de pareamento', () => {
    expect(normalizePairCode('ab cd-ef9h!x')).toBe('ABCDEF9H'); expect(formatPairCode('abcdefgh')).toBe('ABCD-EFGH');
    expect(pairCodeFromHash('#c=abcd-efgh')).toBe('ABCDEFGH'); expect(pairCodeFromHash('')).toBe('');
    expect(pairUrl('https://x.app/', 'ABCD-EFGH')).toBe('https://x.app/cozinha/parear#c=ABCDEFGH');
    expect(secondsLeft('2026-10-19T10:10:00Z', new Date('2026-10-19T10:00:00Z').getTime())).toBe(600);
  });
  it('erros', () => {
    expect(isKitchenMissing({ code: 'PGRST202' })).toBe(true); expect(isKitchenMissing({ code: '23505' })).toBe(false);
    expect(kitchenErrorMessage({ message: 'PIN_INVALID: PIN incorreto.' })).toBe('PIN incorreto.');
    expect(kitchenErrorMessage({ message: 'Anonymous sign-ins are disabled' })).toMatch(/login de aparelhos/);
  });
  it('novos prontos', () => {
    expect(newReadyIds(null, [{ id: 'a', status: 'READY' }])).toEqual([]);
    expect(newReadyIds(new Set(['a']), [{ id: 'a', status: 'READY' }, { id: 'b', status: 'READY' }, { id: 'c', status: 'PREPARING' }])).toEqual(['b']);
  });
});
