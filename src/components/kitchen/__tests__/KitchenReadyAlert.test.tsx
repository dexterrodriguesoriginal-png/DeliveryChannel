// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { KitchenReadyAlert } from '../KitchenReadyAlert';
import type { Order } from '../../../types';
afterEach(cleanup);
it('pedido de mesa pronto abre seu detalhe sem chamar entregador ou navegar ao salão', () => {
  const order = { id: 'round-a', status: 'READY', fulfillmentType: 'DINE_IN', orderNumber: 123, tableLabel: 'Mesa 4' } as Order;
  const view = vi.fn(), call = vi.fn();
  const ui = render(<KitchenReadyAlert orders={[order]} onViewOrder={view} onCallDriver={call} onOpenPickup={vi.fn()} onDismiss={vi.fn()} />);
  expect(ui.queryByRole('button', { name: 'Abrir mesa' })).toBeNull();
  expect(ui.queryByRole('button', { name: 'Chamar entregador' })).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: 'Ver pedido' }));
  expect(view).toHaveBeenCalledWith(order); expect(call).not.toHaveBeenCalled();
});

