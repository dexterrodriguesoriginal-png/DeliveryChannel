// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../../../types';

const mocks = vi.hoisted(() => ({
  auth: {
    activeTenant: null as { id: string; name: string; settings: object } | null,
    securityContext: {}, activeRole: 'OWNER',
  },
  getOrders: vi.fn(), updateStatus: vi.fn(), showToast: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ isModuleEnabled: () => false }) }));
vi.mock('../../../hooks/useOwnerDriverOffers', () => ({ useOwnerDriverOffers: () => ({ offers: [], cancel: async () => {} }) }));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
vi.mock('../../../repositories/orderRepository', () => ({ orderRepository: {
  getOrders: mocks.getOrders, updateStatus: mocks.updateStatus, subscribeToOrders: () => () => {},
} }));
vi.mock('../../../repositories/customerRepository', () => ({ customerRepository: { getCustomers: async () => [] } }));
vi.mock('../../../repositories/driverRepository', () => ({ driverInviteRepository: { listAssignableDrivers: async () => [] } }));
vi.mock('../../../repositories/productRepository', () => ({ productRepository: { getProducts: async () => [] } }));
vi.mock('../../../repositories/arrivalRepository', () => ({ arrivalRepository: { listOpen: async () => [], isOn: () => false } }));
vi.mock('../../../lib/orders/newOrderAlarm', () => ({ useNewOrderAlarm: () => ({}) }));
vi.mock('../../../utils/audio', () => ({ playNewOrderSound: () => {}, playReadySound: () => {} }));
vi.mock('../../../components/establishment/dashboard/StoreHeaderCard', () => ({ StoreHeaderCard: () => null }));
vi.mock('../../../components/establishment/dashboard/OrderAlertsCard', () => ({ OrderAlertsCard: () => null }));
vi.mock('../../../components/establishment/dashboard/NewOrderCards', () => ({ NewOrderCards: () => null }));
vi.mock('../../../components/establishment/dashboard/OpenDiningTabsWarning', () => ({ OpenDiningTabsWarning: () => null }));
vi.mock('../../../components/establishment/dashboard/DemoPackBanner', () => ({ DemoPackBanner: () => null }));
vi.mock('../../../components/establishment/quality/QualityScoreCard', () => ({ QualityScoreCard: () => null }));
vi.mock('../../../components/pickup/PickupHandoverModal', () => ({ PickupHandoverModal: () => null }));

import { EstablishmentDashboard } from '../EstablishmentDashboard';

const order = (extra: Partial<Order> = {}): Order => ({
  id: 'order-1', tenantId: 'tenant-1', orderNumber: 123, customerName: 'Cliente anterior',
  status: 'PREPARING', fulfillmentType: 'DELIVERY', createdAt: new Date().toISOString(),
  totalAmount: 10, items: [], statusHistory: [], paymentMethod: 'CASH', paymentStatus: 'PAID',
  ...extra,
} as Order);
let container: HTMLDivElement;
let root: Root;
const render = async () => { await act(async () => { root.render(<EstablishmentDashboard />); }); };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.activeTenant = { id: 'tenant-1', name: 'Loja', settings: {} };
  mocks.getOrders.mockResolvedValue([order()]);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.restoreAllMocks();
});

describe('ciclo da loja ativa no dashboard', () => {
  it('aguarda a loja sem alterar a ordem dos hooks quando ela chega ou sai', async () => {
    mocks.auth.activeTenant = null;
    await render();
    expect(container.textContent).toBe('');
    mocks.auth.activeTenant = { id: 'tenant-1', name: 'Loja', settings: {} };
    await render();
    expect(container.textContent).toContain('Cliente anterior');
    mocks.auth.activeTenant = null;
    await render();
    expect(container.textContent).toBe('');
  });
  it('descarta os dados da loja anterior antes de carregar a próxima', async () => {
    await render();
    expect(container.textContent).toContain('Cliente anterior');
    mocks.auth.activeTenant = { id: 'tenant-2', name: 'Nova loja', settings: {} };
    mocks.getOrders.mockImplementation(() => new Promise(() => {}));
    await render();
    expect(container.textContent).not.toContain('Cliente anterior');
  });
  it('não mostra toast de uma aceitação concluída após trocar de loja', async () => {
    mocks.getOrders.mockResolvedValue([order({ status: 'PENDING' })]);
    let finishAcceptance: (order: Order) => void;
    mocks.updateStatus.mockResolvedValueOnce(order({ status: 'CONFIRMED' }))
      .mockImplementationOnce(() => new Promise<Order>(resolve => { finishAcceptance = resolve; }));
    await render();
    const accept = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Aceitar pedido')!;
    await act(async () => { accept.click(); });
    expect(mocks.updateStatus).toHaveBeenCalledTimes(2);
    mocks.auth.activeTenant = { id: 'tenant-2', name: 'Nova loja', settings: {} };
    mocks.getOrders.mockResolvedValue([]);
    await render();
    await act(async () => { finishAcceptance!(order({ status: 'PREPARING' })); });
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Cliente anterior');
  });
});

