// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ state: { pending: [] as unknown[], busyId: null as string | null, error: null as string | null, approve: vi.fn(), reject: vi.fn() } }));
vi.mock('../../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../../../../hooks/usePendingApprovals', () => ({ usePendingApprovals: () => h.state }));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('../../../../hooks/useModules', () => ({ useModules: () => ({ isModuleEnabled: () => true }) }));
vi.mock('../../../../repositories/mesasQrRepository', () => ({ mesasQrRepository: { capabilities: vi.fn() } }));

import { ApprovalsAlert } from '../ApprovalsAlert';
import { TableCard } from '../TableCard';
import { deriveTableStatus } from '../../../../lib/salon/tableStatus';

afterEach(cleanup);
const item = { sessionId: 's1', tabId: 't', tableId: 'tb4', tableLabel: 'Mesa 04', displayName: 'Carlos', expiresAt: '' };

describe('aviso de liberação no painel', () => {
  it('sem ninguém esperando não aparece', () => {
    h.state.pending = [];
    const { container } = render(<ApprovalsAlert enabled canReject />);
    expect(container.textContent).toBe('');
  });
  it('mostra mesa e pessoa, com Aprovar e Recusar de um clique; Recusar some sem a migração', () => {
    h.state.pending = [item]; h.state.approve.mockReset(); h.state.reject.mockReset();
    const onOpenTable = vi.fn();
    const { rerender } = render(<ApprovalsAlert enabled canReject onOpenTable={onOpenTable} />);
    expect(screen.getByRole('alert').textContent).toContain('1 mesa aguardando liberação');
    expect(screen.getByTestId('approval-s1').textContent).toContain('Mesa 04');
    expect(screen.getByTestId('approval-s1').textContent).toContain('Carlos quer pedir');
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar Carlos' }));
    expect(h.state.approve).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: 'Recusar Carlos' }));
    expect(h.state.reject).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Mesa 04' }));
    expect(onOpenTable).toHaveBeenCalledWith('tb4');
    rerender(<ApprovalsAlert enabled canReject={false} />);
    expect(screen.queryByRole('button', { name: 'Recusar Carlos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aprovar Carlos' })).toBeTruthy();
  });
});

describe('cartão da mesa no mapa do Salão', () => {
  it('destaca "Aguardando liberação" só quando há liberação pendente', () => {
    const NOW = Date.parse('2026-10-27T15:00:00Z');
    const base = { tab: { id: 'tab1', table_id: 't1', status: 'OPEN' as const, opened_at: new Date(NOW - 60000).toISOString(), service_fee_percent: 10, service_fee_removed: false }, rounds: [], now: NOW };
    const pending = deriveTableStatus({ ...base, sessions: [{ id: 's1', tab_id: 'tab1', approved_at: null }] } as never);
    const { rerender } = render(<TableCard id="t1" label="Mesa 04" area={null} seats={4} info={pending} onOpen={() => {}} />);
    expect(screen.getByTestId('salon-pending-t1').textContent).toContain('Aguardando liberação');
    expect(screen.getByTestId('salon-table-t1').className).toContain('salon-card--PENDING');
    expect(screen.getByTestId('salon-table-t1').getAttribute('aria-label')).toContain('aguardando liberação');
    rerender(<TableCard id="t1" label="Mesa 04" area={null} seats={4} info={deriveTableStatus(base as never)} onOpen={() => {}} />);
    expect(screen.queryByTestId('salon-pending-t1')).toBeNull();
  });
});
