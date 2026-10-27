// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ role: { v: 'OWNER' }, modules: { v: new Set(['dine_in', 'delivery']) } }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ activeTenant: { id: 't1', slug: 'loja', name: 'Loja' }, activeRole: h.role.v }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../hooks/useModules', () => ({ useModules: () => ({ available: true, loading: false, modules: h.modules.v, refresh: vi.fn(), checkCanDisable: vi.fn() }) }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getForTenant: async () => ({ businessType: 'BAR', modules: [] }), setModule: vi.fn(), applyPreset: vi.fn() } }));

import { ModulesPage } from '../ModulesPage';

afterEach(cleanup);

describe('Ferramentas (página)', () => {
  it('título e textos dizem Ferramentas, nunca "Módulo"; Garçom, Mesas e QR e Qualidade do Cardápio são cards', async () => {
    const onNavigate = vi.fn();
    const { container } = render(<ModulesPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getAllByText(/Ferramentas/).length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 1 }).textContent?.trim()).toBe('Ferramentas');
    expect(container.textContent).not.toMatch(/\bM[óo]dulos?\b/i);
    expect(screen.getByText('Aplicativo do Garçom')).toBeTruthy();
    expect(within(screen.getByTestId('tool-mesas-qr')).getByText('Mesas e QR Code')).toBeTruthy();
    expect(within(screen.getByTestId('tool-menu-quality')).getByText('Qualidade do Cardápio')).toBeTruthy();
    expect(screen.queryByTestId('tool-plan-badge')).toBeNull();
    fireEvent.click(within(screen.getByTestId('tool-mesas-qr')).getByRole('button', { name: 'Abrir' }));
    expect(onNavigate).toHaveBeenCalledWith('est-mesas-qr');
  });
  it('explica como adicionar garçons e abre /garcom', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, origin: 'https://loja.app', assign }, configurable: true });
    render(<ModulesPage />);
    expect((await screen.findByTestId('waiter-app-card')).textContent).toMatch(/Convidar Colaborador/);
    expect(screen.getByTestId('waiter-app-card').textContent).toContain('https://loja.app/garcom');
    fireEvent.click(within(screen.getByTestId('waiter-app-card')).getByRole('button', { name: 'Acessar Garçom' }));
    expect(screen.getByTestId('tool-garcom')).toBeTruthy();
    expect(assign).toHaveBeenCalledWith('/garcom');
  });
  it('sem o Salão ligado o card do Garçom não aparece', async () => {
    h.modules.v = new Set(['delivery']);
    render(<ModulesPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('waiter-app-card')).toBeNull();
    h.modules.v = new Set(['dine_in', 'delivery']);
  });
});
