import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ activeTenant: { id: 'tenant-1' }, activeRole: 'WAITER', securityContext: {} }),
}));
vi.mock('../../../hooks/useModules', () => ({
  useModules: () => ({ available: true, isModuleEnabled: () => true }),
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));

import { SalonPage } from '../SalonPage';

describe('SalonPage', () => {
  it('renders the staff salon screen shell and live alert bar', () => {
    const html = renderToStaticMarkup(<SalonPage />);
    expect(html).toContain('data-testid="salon-page"');
    expect(html).toContain('>Salão</h1>');
    expect(html).toContain('data-testid="salon-alerts"');
    expect(html).toContain('Carregando o salão');
  });
});
