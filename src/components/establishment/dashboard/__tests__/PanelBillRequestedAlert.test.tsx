// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  tenantId: 'tenant-1',
  userId: 'owner-1',
  role: 'OWNER' as string | null,
  fromCalls: 0,
  deferNextTabs: false,
  finishTabs: null as null | ((value: unknown) => void),
  ordersError: null as null | { code: string },
  tabs: [] as Array<Record<string, unknown>>,
  tables: [] as Array<Record<string, unknown>>,
  orders: [] as Array<Record<string, unknown>>,
  realtimeCb: null as null | (() => void),
  beep: vi.fn(),
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({
    activeTenant: { id: h.tenantId },
    activeRole: h.role,
    supabaseUser: { id: h.userId },
  }),
}));

vi.mock('../../../../hooks/useModules', () => ({
  useModules: () => ({ available: true, isModuleEnabled: () => true }),
}));

vi.mock('../../../../utils/audio', () => ({
  playShortBeep: (...args: unknown[]) => h.beep(...args),
}));

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      h.fromCalls += 1;
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'neq', 'order']) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => {
        const data = table === 'dining_tabs' ? h.tabs : table === 'dining_tables' ? h.tables : h.orders;
        if (table === 'dining_tabs' && h.deferNextTabs) {
          h.deferNextTabs = false;
          return new Promise(done => { h.finishTabs = done; }).then(resolve);
        }
        return Promise.resolve({ data, error: table === 'orders' ? h.ordersError : null }).then(resolve);
      };
      return b;
    },
    channel: () => {
      const c: Record<string, unknown> = {
        on: (_evt: string, _filter: unknown, cb: () => void) => {
          h.realtimeCb = cb;
          return c;
        },
        subscribe: () => c,
      };
      return c;
    },
    removeChannel: vi.fn(),
  },
}));

import { PanelBillRequestedAlert } from '../OpenDiningTabsWarning';
import { savePreferences } from '../../../../lib/notifications/preferences';

beforeEach(() => {
  localStorage.clear();
  h.tenantId = 'tenant-1';
  h.userId = 'owner-1';
  h.role = 'OWNER';
  h.fromCalls = 0; h.deferNextTabs = false; h.finishTabs = null; h.ordersError = null;
  h.beep.mockReset();
  h.realtimeCb = null;
  h.tables = [
    { id: 't3', label: 'Mesa 03' },
    { id: 't7', label: 'Mesa 07' },
  ];
  h.tabs = [
    { id: 'tab-3', table_id: 't3', status: 'BILL_REQUESTED', opened_at: '2026-11-04T12:00:00Z', service_fee_percent: 10, service_fee_removed: false },
    { id: 'tab-7', table_id: 't7', status: 'BILL_REQUESTED', opened_at: '2026-11-04T12:05:00Z', service_fee_percent: 0, service_fee_removed: false },
  ];
  h.orders = [
    { id: 'o1', tab_id: 'tab-3', subtotal: 100, status: 'DELIVERED' },
    { id: 'o2', tab_id: 'tab-7', subtotal: 45.5, status: 'DELIVERED' },
  ];
});

afterEach(cleanup);

describe('PanelBillRequestedAlert — Item 13', () => {
  it('empilha múltiplas mesas em BILL_REQUESTED mostrando total e aciona Ver conta / Fechar conta / Dispensar', async () => {
    savePreferences(localStorage, 'tenant-1', 'owner-1', { balloon: true, sound: true });
    const onView = vi.fn();
    const onCheckout = vi.fn();

    render(<PanelBillRequestedAlert onViewBill={onView} onCheckoutBill={onCheckout} />);

    await waitFor(() => expect(screen.getByTestId('bill-requested-toast-tab-3')).toBeTruthy());
    expect(screen.getByTestId('bill-requested-toast-tab-3').textContent).toContain('Mesa 03 pediu a conta — R$ 110,00');
    expect(screen.getByTestId('bill-requested-toast-tab-7').textContent).toContain('Mesa 07 pediu a conta — R$ 45,50');
    await waitFor(() => expect(h.beep).toHaveBeenCalledTimes(1));

    // Clicar em "Ver conta" na Mesa 03 abre o painel lateral da mesa e dispensa o balão da Mesa 03
    const toast3 = screen.getByTestId('bill-requested-toast-tab-3');
    fireEvent.click(toast3.querySelectorAll('button')[1]); // Ver conta
    expect(onView).toHaveBeenCalledWith('t3');
    expect(screen.queryByTestId('bill-requested-toast-tab-3')).toBeNull();
    expect(screen.getByTestId('bill-requested-toast-tab-7')).toBeTruthy();

    // Clicar em "Fechar conta" na Mesa 07 abre o checkout da mesa
    const toast7 = screen.getByTestId('bill-requested-toast-tab-7');
    fireEvent.click(toast7.querySelectorAll('button')[2]); // Fechar conta
    expect(onCheckout).toHaveBeenCalledWith('t7');
    expect(screen.queryByTestId('bill-requested-toast-tab-7')).toBeNull();
  });

  it('respeita Som desligado e atualiza em tempo real via assinatura de dining_tabs', async () => {
    savePreferences(localStorage, 'tenant-1', 'owner-1', { balloon: true, sound: false });
    h.tabs = [{ id: 'tab-3', table_id: 't3', status: 'OPEN', opened_at: '2026-11-04T12:00:00Z', service_fee_percent: 10, service_fee_removed: false }];

    render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    expect(h.beep).not.toHaveBeenCalled();

    // Cliente pede a conta em tempo real
    h.tabs = [{ id: 'tab-3', table_id: 't3', status: 'BILL_REQUESTED', opened_at: '2026-11-04T12:00:00Z', service_fee_percent: 10, service_fee_removed: false }];
    await act(async () => { h.realtimeCb?.(); });

    await waitFor(() => expect(screen.getByTestId('bill-requested-toast-tab-3')).toBeTruthy());
    expect(h.beep).not.toHaveBeenCalled();

    // Dispensar no botão X remove o balão
    fireEvent.click(screen.getByLabelText('Dispensar aviso da Mesa 03'));
    expect(screen.queryByTestId('bill-requested-toast-tab-3')).toBeNull();
  });
});


describe('isolamento e atualização do alerta de conta pedida', () => {
  it.each([null, 'WAITER', 'DRIVER'])('não consulta nem exibe dados financeiros para papel %s', async role => {
    h.role = role;
    render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    expect(h.fromCalls).toBe(0); expect(h.beep).not.toHaveBeenCalled();
  });

  it('retira dados imediatamente quando o papel do painel é revogado e ignora callback antigo', async () => {
    const view = render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await screen.findByTestId('bill-requested-toast-tab-3');
    const oldCallback = h.realtimeCb; const calls = h.fromCalls;
    h.role = null;
    view.rerender(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    await act(async () => { oldCallback?.(); });
    expect(h.fromCalls).toBe(calls);
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
  });

  it('oculta imediatamente o aviso do usuário anterior na mesma loja', async () => {
    const view = render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await screen.findByTestId('bill-requested-toast-tab-3');
    h.userId = 'outro-caixa'; h.deferNextTabs = true;
    view.rerender(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    await waitFor(() => expect(h.finishTabs).not.toBeNull());
    await act(async () => { h.finishTabs!({ data: [], error: null }); });
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
  });

  it('ignora a resposta pendente do usuário anterior na mesma loja', async () => {
    h.deferNextTabs = true;
    const view = render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await waitFor(() => expect(h.finishTabs).not.toBeNull());
    const oldResult = h.tabs;
    h.userId = 'outro-caixa'; h.tabs = [];
    view.rerender(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await act(async () => { h.finishTabs!({ data: oldResult, error: null }); });
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    expect(h.beep).not.toHaveBeenCalled();
  });

  it('não restaura conta pedida a partir de polling antigo depois de uma atualização mais nova', async () => {
    render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await screen.findByTestId('bill-requested-toast-tab-3');
    const requested = h.tabs;
    h.deferNextTabs = true;
    await act(async () => { h.realtimeCb?.(); });
    expect(h.finishTabs).not.toBeNull();
    h.tabs = [];
    await act(async () => { h.realtimeCb?.(); });
    await waitFor(() => expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull());
    await act(async () => { h.finishTabs!({ data: requested, error: null }); });
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    await waitFor(() => expect(h.beep).toHaveBeenCalledTimes(1));
  });

  it('não inventa saldo zero se a consulta de pedidos falhar', async () => {
    h.ordersError = { code: '42501' };
    render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    const toast = await screen.findByTestId('bill-requested-toast-tab-3');
    expect(toast.textContent).toContain('Total indisponível');
    expect(toast.textContent).not.toContain('R$ 0,00');
    expect(toast.textContent).toContain('Fechar conta');
  });

  it('respeita Balão desligado e sincroniza alterações de preferência', async () => {
    savePreferences(localStorage, 'tenant-1', 'owner-1', { balloon: false, sound: false });
    render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await waitFor(() => expect(h.fromCalls).toBeGreaterThanOrEqual(3));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
    expect(h.beep).not.toHaveBeenCalled();
    act(() => savePreferences(localStorage, 'tenant-1', 'owner-1', { balloon: true, sound: false }));
    expect(await screen.findByTestId('bill-requested-toast-tab-3')).toBeTruthy();
    act(() => savePreferences(localStorage, 'tenant-1', 'owner-1', { balloon: false, sound: false }));
    expect(screen.queryByTestId('bill-requested-toast-stack')).toBeNull();
  });

  it('avisa novamente se a conta é reaberta e pedida outra vez', async () => {
    render(<PanelBillRequestedAlert onViewBill={vi.fn()} onCheckoutBill={vi.fn()} />);
    await screen.findByTestId('bill-requested-toast-tab-3');
    fireEvent.click(screen.getByLabelText('Dispensar aviso da Mesa 03'));
    const requested = h.tabs;
    h.tabs = [];
    await act(async () => { h.realtimeCb?.(); });
    h.tabs = requested;
    await act(async () => { h.realtimeCb?.(); });
    expect(await screen.findByTestId('bill-requested-toast-tab-3')).toBeTruthy();
    expect(h.beep).toHaveBeenCalledTimes(2);
  });
});

