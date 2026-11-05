// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ role: { v: 'OWNER' }, modules: { v: new Set(['dine_in', 'delivery']) }, tools: { waiter: true, kitchen: false }, listTools: vi.fn(), setTool: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: { id: 't1', slug: 'loja', name: 'Loja' }, activeRole: h.role.v }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, modules: h.modules.v, refresh: vi.fn(), checkCanDisable: vi.fn() }) }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getForTenant: async () => ({ businessType: 'BAR', modules: [] }), setModule: vi.fn(), applyPreset: vi.fn() } }));
vi.mock('../../../repositories/storeTeamRepository', () => ({ storeTeamRepository: { listTools: h.listTools, setTool: h.setTool } }));

import { ModulesPage } from '../ModulesPage';
beforeEach(() => {
  h.role.v = 'OWNER'; h.modules.v = new Set(['dine_in', 'delivery']); h.tools = { waiter: true, kitchen: false };
  h.listTools.mockReset().mockImplementation(async () => h.tools); h.setTool.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Ferramentas (página)', () => {
  it('shows optional tools once and keeps existing operational tools', async () => {
    const onNavigate = vi.fn();
    const { container } = render(<ModulesPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getAllByText(/Ferramentas/).length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBe('Ferramentas');
    expect(container.textContent).not.toMatch(/\bM[óo]dulos?\b/i);
    expect(screen.getAllByRole('heading', { name: 'Garçom' })).toHaveLength(1);
    expect(within(screen.getByTestId('store-tool-kitchen')).getByRole('heading', { name: 'Cozinha' })).toBeTruthy();
    expect(screen.queryByTestId('tool-module-kds')).toBeNull();
    expect(within(screen.getByTestId('tool-mesas-qr')).getByText('Mesas e QR Code')).toBeTruthy();
    expect(within(screen.getByTestId('tool-menu-quality')).getByText('Qualidade do Cardápio')).toBeTruthy();
    expect(screen.queryByTestId('tool-plan-badge')).toBeNull();
    fireEvent.click(within(screen.getByTestId('tool-mesas-qr')).getByRole('button', { name: 'Abrir' }));
    expect(onNavigate).toHaveBeenCalledWith('est-mesas-qr');
  });
  it('offers only switches for optional tools and keeps people and QR in Equipe', async () => {
    render(<ModulesPage />);
    const waiter = await screen.findByTestId('store-tool-waiter');
    await waitFor(() => expect((within(waiter).getByRole('switch') as HTMLButtonElement).disabled).toBe(false));
    expect(waiter.textContent).toContain('Pessoas, convites e QR ficam em Equipe e permissões.');
    expect(screen.queryByTestId('waiter-app-card')).toBeNull();
    expect(screen.queryByTestId('tool-garcom')).toBeNull();
    expect(screen.queryByTestId('waiter-access-block')).toBeNull();
    expect(screen.queryByRole('button', { name: /Convidar garçom|Acessar Garçom/ })).toBeNull();
    fireEvent.click(within(waiter).getByRole('switch', { name: 'Desativar Garçom' }));
    await waitFor(() => expect(h.setTool).toHaveBeenCalledWith('t1', 'waiter', false));
    expect(within(waiter).getByRole('switch').getAttribute('aria-checked')).toBe('false');
  });
  it('allows the owner to enable kitchen independently from the salon', async () => {
    h.modules.v = new Set(['delivery']);
    render(<ModulesPage />);
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Ativar Cozinha' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('switch', { name: 'Ativar Cozinha' }));
    await waitFor(() => expect(h.setTool).toHaveBeenCalledWith('t1', 'kitchen', true));
    expect(screen.getByRole('switch', { name: 'Desativar Cozinha' }).getAttribute('aria-checked')).toBe('true');
  });
  it('keeps optional tool switches read only for a manager', async () => {
    h.role.v = 'MANAGER';
    render(<ModulesPage />);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Desativar Garçom' })).toBeTruthy());
    const waiterSwitch = screen.getByRole('switch', { name: 'Desativar Garçom' });
    expect((waiterSwitch as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(waiterSwitch);
    expect(h.setTool).not.toHaveBeenCalled();
  });
});

