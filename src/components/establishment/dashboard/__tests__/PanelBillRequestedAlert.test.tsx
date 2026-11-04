// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  tenantId: 'tenant-1',
  userId: 'owner-1',
  role: 'OWNER',
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
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'neq', 'order']) b[m] = () => b;
      b.then = (resolve: (v: unknown) => unknown) => {
        const data = table === 'dining_tabs' ? h.tabs : table === 'dining_tables' ? h.tables : h.orders;
        return Promise.resolve({ data, error: null }).then(resolve);
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
    expect(h.beep).toHaveBeenCalledTimes(1);

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
