// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  db: {} as Record<string, unknown[]>,
  rpc: vi.fn(),
  pix: { createTabPix: vi.fn(), tabPixStatus: vi.fn(), cancelTabPix: vi.fn(), observeTabPix: vi.fn().mockReturnValue(() => {}), receiptTarget: vi.fn(), sendTabReceipt: vi.fn() },
  role: { value: 'OWNER' },
  tenant: { id: 'tenant-1', slug: 'loja' },
  security: {},
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: h.tenant, activeRole: h.role.value, securityContext: h.security }) }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, isModuleEnabled: () => true }) }));
vi.mock('../../../utils/audio', () => ({ playShortBeep: vi.fn() }));
vi.mock('../../../repositories/productRepository', () => ({ productRepository: { getProducts: async () => [] } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map() } }));
vi.mock('../../../repositories/paymentRepository', () => ({ paymentRepository: h.pix }));
vi.mock('../../../lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const result = () => ({ data: h.db[table] ?? [], error: null });
    for (const m of ['select', 'eq', 'in', 'neq', 'gt', 'gte', 'order', 'limit']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: (h.db[table] ?? [])[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: (...a: unknown[]) => h.rpc(...a) }, isSupabaseConfigured: true };
});

import { SalonPage } from '../SalonPage';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const seed = () => {
  h.db = {
    dining_tables: [
      { id: 't1', label: 'Mesa 01', area: 'Salão', seats: 4, active: true },
      { id: 't2', label: 'Mesa 02', area: 'Salão', seats: 4, active: true },
      { id: 't5', label: 'Mesa 05', area: 'Varanda', seats: 2, active: true },
      { id: 't15', label: 'Mesa 15', area: 'Varanda', seats: 6, active: true },
    ],
    dining_tabs: [
      { id: 'tab2', table_id: 't2', status: 'OPEN', opened_at: ago(10), service_fee_percent: 10, service_fee_removed: false },
      { id: 'tab5', table_id: 't5', status: 'OPEN', opened_at: ago(95), service_fee_percent: 0, service_fee_removed: false },
      { id: 'tab15', table_id: 't15', status: 'BILL_REQUESTED', opened_at: ago(30), service_fee_percent: 0, service_fee_removed: false },
    ],
    tenant_modules: [{ config: { close_roles: ['OWNER', 'MANAGER', 'CASHIER'] } }],
    tab_sessions: [], waiter_calls: [{ id: 'c1', tab_id: 'tab2', type: 'CALL', status: 'OPEN', created_at: ago(2) }],
    orders: [
      { id: 'o2', tab_id: 'tab2', order_number: 7, customer_name: 'Ana', status: 'PREPARING', subtotal: 100, created_at: ago(8), round_no: 1 },
      { id: 'o5', tab_id: 'tab5', order_number: 8, customer_name: 'Beto', status: 'DELIVERED', subtotal: 50, created_at: ago(90), round_no: 1 },
      { id: 'o15', tab_id: 'tab15', order_number: 9, customer_name: 'Caio', status: 'DELIVERED', subtotal: 80, created_at: ago(28), round_no: 1 },
    ],
    tab_payments: [],
  };
};
const caps = (over: Record<string, unknown> = {}) => h.rpc.mockImplementation(async (name: string) =>
  name === 'mesas_qr_capabilities' ? { data: { version: 1, qr_pause: true, tab_pix: true, ...over }, error: null } : { data: null, error: null });
const noMigration = () => h.rpc.mockImplementation(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.mesas_qr_capabilities' } }));
const status = (id: string) => screen.getByTestId(`salon-table-${id}`).getAttribute('data-status');

beforeEach(() => { seed(); h.rpc.mockReset(); Object.values(h.pix).forEach(m => m.mockReset()); h.pix.tabPixStatus.mockResolvedValue({ pix: null }); h.pix.observeTabPix.mockReturnValue(() => {});  h.role.value = 'OWNER'; localStorage.clear(); localStorage.setItem('salon_sidebar_open', 'true'); window.location.hash = '';  });
afterEach(cleanup);

describe('SalonPage — mapa de mesas', () => {
  it('colore cada mesa pelo status e conta nos filtros', async () => {
    noMigration();
    render(<SalonPage />);
    await waitFor(() => expect(screen.getByTestId('salon-table-t1')).toBeTruthy());
    expect(status('t1')).toBe('FREE');
    expect(status('t2')).toBe('PREPARING');
    expect(status('t5')).toBe('LONG_STAY');
    expect(status('t15')).toBe('BILL');
    expect(screen.getByTestId('salon-bell-t2')).toBeTruthy();
    expect(screen.getByTestId('salon-filter-FREE').textContent).toContain('1');
    expect(screen.getByTestId('salon-filter-ALL').textContent).toContain('4');
    expect(screen.getByTestId('salon-total-t2').textContent).toMatch(/110,00/);
  });
  it('busca (15 não acha a 5) e filtros por status', async () => {
    noMigration();
    render(<SalonPage />);
    await waitFor(() => expect(screen.getByTestId('salon-table-t1')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Buscar mesa'), { target: { value: '5' } });
    expect(screen.queryByTestId('salon-table-t15')).toBeNull();
    expect(screen.getByTestId('salon-table-t5')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar mesa'), { target: { value: 'varanda' } });
    expect(screen.getByTestId('salon-table-t15')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar mesa'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('salon-filter-BILL'));
    expect(screen.queryByTestId('salon-table-t1')).toBeNull();
    expect(screen.getByTestId('salon-table-t15')).toBeTruthy();
    fireEvent.click(screen.getByTestId('salon-filter-CALL'));
    expect(screen.getByTestId('salon-table-t2')).toBeTruthy();
    expect(screen.queryByTestId('salon-table-t5')).toBeNull();
  });
  it('limite de mesa longa é configurável e guardado por loja', async () => {
    noMigration();
    render(<SalonPage />);
    await waitFor(() => expect(screen.getByTestId('salon-table-t1')).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/marcar mesa como ocupada há muito tempo/), { target: { value: '180' } });
    expect(status('t5')).toBe('OCCUPIED');
    expect(localStorage.getItem('salon_long_stay_tenant-1')).toBe('180');
  });
  it('painel lateral lista comandas abertas e chamados; clicar abre a comanda da mesa', async () => {
    noMigration();
    render(<SalonPage />);
    await waitFor(() => expect(screen.getByTestId('salon-sidebar')).toBeTruthy());
    const side = within(screen.getAllByTestId('salon-sidebar')[0]);
    expect(side.getByTestId('salon-open-tab5').textContent).toContain('Mesa 05');
    fireEvent.click(side.getByRole('tab', { name: /Chamados/ }));
    expect(side.getByTestId('salon-call-c1').textContent).toContain('Mesa 02');
    fireEvent.click(side.getByTestId('salon-call-c1').querySelector('button')!);
    expect(screen.getByRole('dialog', { name: /Comanda Mesa 02/ })).toBeTruthy();
  });

  describe('antes da migração (banco sem as funções novas)', () => {
    it('esconde pausa de QR e PIX da conta, mas o fechamento manual segue igual', async () => {
      noMigration();
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByTestId('salon-table-t2')).toBeTruthy());
      expect(screen.queryByText(/Pausar pedidos por QR/)).toBeNull();
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: /Fechar conta/ }));
      expect(await screen.findByRole('button', { name: 'Confirmar recebimento e fechar conta' })).toBeTruthy();
      expect(screen.queryByTestId('tab-pix-panel')).toBeNull();
      expect(h.pix.tabPixStatus).not.toHaveBeenCalled();
    });
  });

  describe('depois da migração', () => {
    it('dono autoriza a comanda solicitada e mantém contas autorizadas/aguardando no mapa', async () => {
      caps();
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByTestId('salon-table-t15')).toBeTruthy());
      fireEvent.click(screen.getByTestId('salon-table-t15'));
      fireEvent.click(await screen.findByRole('button', { name: 'Autorizar garçom a fechar' }));
      await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('authorize_waiter_to_close', { p_tab_id: 'tab15' }));
    });
    it('link de fechar conta do dashboard abre a mesa da loja e o checkout', async () => {
      caps(); window.location.hash = '#/painel/est-salon?table=t15&checkout=1';
      render(<SalonPage />);
      expect(await screen.findByRole('heading', { name: /Revisar e fechar conta/ })).toBeTruthy();
      expect(screen.getByLabelText('Forma de pagamento 1')).toBeTruthy();
      expect(h.rpc.mock.calls.some(([name]) => name === 'close_tab')).toBe(false);
    });
    it('não abre checkout para mesa de outra loja no link', async () => {
      caps(); window.location.hash = '#/painel/est-salon?table=outra-loja&checkout=1';
      render(<SalonPage />);
      await screen.findByTestId('salon-table-t1');
      expect(screen.queryByRole('heading', { name: /Revisar e fechar conta/ })).toBeNull();
    });
    it('dinheiro só fecha depois de escolher a forma e confirmar recebimento', async () => {
      caps();
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByTestId('salon-table-t2')).toBeTruthy());
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: /Fechar conta/ }));
      const confirm = screen.getByRole('button', { name: 'Confirmar recebimento e fechar conta' });
      expect(confirm.hasAttribute('disabled')).toBe(true);
      fireEvent.change(screen.getByLabelText('Forma de pagamento 1'), { target: { value: 'CASH' } });
      expect(confirm.hasAttribute('disabled')).toBe(true);
      fireEvent.click(screen.getByLabelText('Confirmei o recebimento'));
      expect(confirm.hasAttribute('disabled')).toBe(false);
      fireEvent.click(confirm);
      await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('close_tab', { p_tab_id: 'tab2', p_payments: [{ method: 'CASH', amount_cents: 11000, change_given_cents: 0 }] }));
    });
    it('reabre o QR pendente em vez de tratar a mesa aguardando pagamento como livre', async () => {
      (h.db.dining_tabs[0] as any).status = 'AWAITING_PAYMENT';
      caps();
      h.pix.tabPixStatus.mockResolvedValue({ pix: { id: 'p', tabId: 'tab2', amountCents: 11000, status: 'pending', brcode: 'PIXCODE', expiresAt: new Date(Date.now() + 600000).toISOString(), needsReview: false, reviewReason: null, tabClosed: false } });
      render(<SalonPage />);
      await waitFor(() => expect(status('t2')).toBe('AWAITING_PAYMENT'));
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: 'Ver pagamento pendente' }));
      expect(await screen.findByTestId('tab-pix-qr')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Confirmar recebimento/ })).toBeNull();
      expect(h.rpc.mock.calls.some(([name]) => name === 'close_tab')).toBe(false);
    });
    it('só mostra Gerar Pix depois de escolher Pix e nunca oferece fechamento manual para Pix', async () => {
      caps();
      h.pix.createTabPix.mockResolvedValue({ pix: { id: 'p', tabId: 'tab2', amountCents: 11000, status: 'pending', brcode: 'PIXCODE', expiresAt: new Date(Date.now() + 600000).toISOString(), needsReview: false, reviewReason: null, tabClosed: false } });
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByText('Pausar pedidos por QR')).toBeTruthy());
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: /Fechar conta/ }));
      expect(screen.queryByTestId('tab-pix-panel')).toBeNull();
      expect(screen.getByRole('button', { name: 'Confirmar recebimento e fechar conta' }).hasAttribute('disabled')).toBe(true);
      fireEvent.change(screen.getByLabelText('Forma de pagamento 1'), { target: { value: 'PIX' } });
      expect(await screen.findByTestId('tab-pix-panel')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Confirmar recebimento/ })).toBeNull();
      fireEvent.click(await screen.findByRole('button', { name: /Gerar QR PIX de/ }));
      expect(h.rpc.mock.calls.some(([name]) => name === 'close_tab')).toBe(false);
    });
    it('mantém confirmação e comprovante após refresh remover a comanda paga', async () => {
      (h.db.dining_tabs[0] as any).status = 'AWAITING_PAYMENT';
      caps();
      let refreshPix: (() => void) | null = null;
      h.pix.observeTabPix.mockImplementation((_tabId: string, refresh: () => void) => { refreshPix = refresh; return () => {}; });
      const pix = { id: 'p', tabId: 'tab2', amountCents: 11000, status: 'pending', brcode: 'PIXCODE', expiresAt: new Date(Date.now() + 600000).toISOString(), needsReview: false, reviewReason: null, tabClosed: false };
      h.pix.tabPixStatus.mockResolvedValue({ pix });
      render(<SalonPage />);
      fireEvent.click(await screen.findByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: 'Ver pagamento pendente' }));
      await screen.findByTestId('tab-pix-qr');
      h.db.dining_tabs = h.db.dining_tabs.filter(row => (row as { id: string }).id !== 'tab2');
      h.db.orders = h.db.orders.filter(row => (row as { tab_id: string }).tab_id !== 'tab2');
      h.pix.tabPixStatus.mockResolvedValue({ pix: { ...pix, status: 'paid', tabClosed: true, paidAt: new Date().toISOString() } });
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
      await act(async () => { refreshPix!(); });
      const confirmation = await screen.findByRole('region', { name: 'Pagamento confirmado' });
      await waitFor(() => expect(status('t2')).toBe('FREE'));
      expect(confirmation.textContent).toContain('Mesa 02');
      expect(confirmation.textContent).toMatch(/110,00/);
      expect(within(confirmation).getByRole('button', { name: 'Enviar comprovante por e-mail' })).toBeTruthy();
      fireEvent.click(within(confirmation).getByRole('button', { name: 'Concluir' }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Pagamento confirmado' })).toBeNull());
      expect(h.rpc.mock.calls.some(([name]) => name === 'close_tab')).toBe(false);
    });
    it('PIX ativo bloqueia o fechamento manual (evita cobrança em duplicidade)', async () => {
      caps();
      h.pix.tabPixStatus.mockResolvedValue({ pix: { id: 'p', tabId: 'tab2', amountCents: 11000, status: 'pending', brcode: 'PIXCODE', expiresAt: new Date(Date.now() + 600000).toISOString(), needsReview: false, reviewReason: null, tabClosed: false } });
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByText('Pausar pedidos por QR')).toBeTruthy());
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: /Fechar conta/ }));
      fireEvent.change(screen.getByLabelText('Forma de pagamento 1'), { target: { value: 'PIX' } });
      await screen.findByTestId('tab-pix-qr');
      expect(screen.queryByRole('button', { name: /Confirmar recebimento/ })).toBeNull();
      expect(screen.getByLabelText('Forma de pagamento 1').hasAttribute('disabled')).toBe(true);
      expect(h.rpc.mock.calls.some(([name]) => name === 'close_tab')).toBe(false);
    });
    it('garçom não vê pausa de QR nem PIX (só quem pode fechar a conta)', async () => {
      h.role.value = 'WAITER';
      caps();
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByTestId('salon-table-t2')).toBeTruthy());
      await new Promise(r => setTimeout(r, 30));
      expect(screen.queryByText('Pausar pedidos por QR')).toBeNull();
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      expect(screen.queryByRole('button', { name: /Fechar conta/ })).toBeNull();
    });
    it('modal Lançar pedido na mesa carrega o cardápio da loja (com busca, categorias e foto) e o botão diz Fazer pedido', async () => {
      h.role.value = 'WAITER';
      h.rpc.mockImplementation(async (name: string) => {
        if (name === 'mesas_qr_capabilities') return { data: { version: 1, qr_pause: true, tab_pix: true }, error: null };
        if (name === 'get_public_store') {
          return {
            data: {
              tenant: { id: 'tenant-1', name: 'Loja', slug: 'loja' },
              categories: [
                { id: 'cat-1', tenantId: 'tenant-1', name: 'Lanches', order: 1, isActive: true },
                { id: 'cat-2', tenantId: 'tenant-1', name: 'Bebidas', order: 2, isActive: true },
              ],
              products: [
                { id: 'p-burger', tenantId: 'tenant-1', categoryId: 'cat-1', name: 'Smash Duplo', description: 'Pão brioche', price: 32, imageUrl: 'https://cdn.example.com/burger.jpg', isActive: true, isAvailable: false },
                { id: 'p-soda', tenantId: 'tenant-1', categoryId: 'cat-2', name: 'Guaraná Lata', description: '350ml', price: 8, imageUrl: '', isActive: true, isAvailable: true },
              ],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });
      render(<SalonPage />);
      await waitFor(() => expect(screen.getByTestId('salon-table-t2')).toBeTruthy());
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      fireEvent.click(await screen.findByRole('button', { name: /Lançar pedido/ }));

      expect(await screen.findByText('Lançar pedido na mesa')).toBeTruthy();
      expect(screen.queryByText('Enviar para a cozinha')).toBeNull();
      const submitBtn = screen.getByRole('button', { name: 'Fazer pedido' });
      expect(submitBtn.hasAttribute('disabled')).toBe(true);

      expect(await screen.findByTestId('salon-order-product-p-burger')).toBeTruthy();
      expect(screen.getByTestId('salon-order-product-p-soda')).toBeTruthy();
      const img = screen.getByAltText('Smash Duplo') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('https://cdn.example.com/burger.jpg');

      const categoriesGroup = screen.getByRole('group', { name: 'Categorias' });
      fireEvent.click(within(categoriesGroup).getByRole('button', { name: 'Bebidas' }));
      expect(screen.queryByTestId('salon-order-product-p-burger')).toBeNull();
      expect(screen.getByTestId('salon-order-product-p-soda')).toBeTruthy();

      fireEvent.click(within(categoriesGroup).getByRole('button', { name: 'Todas' }));
      fireEvent.change(screen.getByLabelText('Buscar produto'), { target: { value: 'smash' } });
      expect(screen.getByTestId('salon-order-product-p-burger')).toBeTruthy();
      expect(screen.queryByTestId('salon-order-product-p-soda')).toBeNull();

      fireEvent.click(screen.getByTestId('salon-order-product-p-burger'));
      expect(submitBtn.hasAttribute('disabled')).toBe(false);
    });

    it('exibe mesas juntas com a mesma cor/comanda, histórico de trocas ("Mesa 01 → Mesa 02"), Juntar/Separar e toggle de código de entrega', async () => {
      caps();
      h.db.dining_tab_tables = [
        { tab_id: 'tab2', table_id: 't1', joined_at: ago(5) },
      ];
      h.db.tab_table_moves = [
        {
          id: 'mv-1',
          tab_id: 'tab2',
          action: 'MOVE',
          from_label: 'Mesa 01',
          to_label: 'Mesa 02',
          actor_kind: 'CUSTOMER',
          actor_name: 'Ana',
          created_at: ago(4),
        },
      ];
      h.rpc.mockImplementation(async (name: string) => {
        if (name === 'mesas_qr_capabilities') return { data: { version: 1, qr_pause: true, tab_pix: true }, error: null };
        if (name === 'set_salon_delivery_code_required') return { data: { require_delivery_code: true }, error: null };
        if (name === 'staff_join_tables') return { data: { tabId: 'tab2', primaryTableId: 't2', joinedTableIds: ['t2', 't5'] }, error: null };
        if (name === 'staff_separate_table') return { data: { tabId: 'tab2', separatedTableId: 't1' }, error: null };
        return { data: null, error: null };
      });

      render(<SalonPage />);
      await waitFor(() => expect(screen.getByTestId('salon-table-t1')).toBeTruthy());

      // t1 está ligada à tab2, portanto compartilha o status PREPARING e o selo de mesas juntas
      expect(status('t1')).toBe('PREPARING');
      expect(screen.getByTestId('salon-joined-t1').textContent).toContain('Mesa 02 + Mesa 01');
      expect(screen.getByTestId('salon-table-move-banner').textContent).toContain('Mesa 01 → Mesa 02');

      // Abrir detalhes da mesa mostra mesas juntas, botão Separar e histórico
      fireEvent.click(screen.getByTestId('salon-table-t2'));
      expect(await screen.findByTestId('salon-joined-tables')).toBeTruthy();
      expect(screen.getByTestId('salon-table-moves').textContent).toContain('Mesa 01 → Mesa 02');

      fireEvent.click(screen.getByTestId('salon-separate-table-t1'));
      await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('staff_separate_table', { p_tab_id: 'tab2', p_table_id: 't1' }));

      // Toggle "Exigir código de entrega na mesa"
      fireEvent.click(screen.getByTestId('salon-toggle-delivery-code'));
      await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('set_salon_delivery_code_required', { p_tenant: 'tenant-1', p_enabled: true }));

      // Modal "Juntar mesas"
      fireEvent.click(screen.getByTestId('salon-join-tables-btn'));
      expect(await screen.findByTestId('salon-join-tables-modal')).toBeTruthy();
      fireEvent.click(screen.getByTestId('salon-join-option-t2'));
      fireEvent.click(screen.getByTestId('salon-join-option-t5'));
      fireEvent.click(screen.getByTestId('salon-confirm-join-tables'));
      await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('staff_join_tables', { p_table_ids: ['t2', 't5'] }));
    });
  });
});
