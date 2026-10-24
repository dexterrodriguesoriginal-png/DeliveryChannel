import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import { renderToStaticMarkup } from 'react-dom/server';

let mockRole = 'OWNER';
let mockTenant: { id: string; slug: string; name: string } | null = {
  id: 'tenant-adega-01',
  slug: 'adega-premium',
  name: 'Adega Premium Jardins',
};

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    activeTenant: mockTenant,
    activeRole: mockRole,
  }),
}));

vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

import { CustomersPage } from '../CustomersPage';
import { customerRepository } from '../../../repositories/customerRepository';

describe('CustomersPage CRM shell, RBAC & local demo workflows', () => {
  beforeEach(() => {
    mockRole = 'OWNER';
    mockTenant = {
      id: 'tenant-adega-01',
      slug: 'adega-premium',
      name: 'Adega Premium Jardins',
    };
  });

  it('renders executive KPI overview, commercial segment filters, and owner actions', () => {
    const html = renderToStaticMarkup(<CustomersPage />);
    expect(html).toContain('>Clientes</h1>');
    expect(html).toContain('Total na Base da Loja');
    expect(html).toContain('Clientes com Compras');
    expect(html).toContain('Receita Acumulada &amp; Ticket');
    expect(html).toContain('Permissão de Contato &amp; Retenção');
    expect(html).toContain('Loja Digital / App');
    expect(html).toContain('Cadastro Manual');
    expect(html).toContain('Exportar');
    expect(html).toContain('Adicionar cliente');
  });

  it('hides the Exportar button when the active role is MANAGER instead of OWNER', () => {
    mockRole = 'MANAGER';
    const html = renderToStaticMarkup(<CustomersPage />);
    expect(html).toContain('>Clientes</h1>');
    expect(html).toContain('Adicionar cliente');
    expect(html).not.toContain('>Exportar<');
  });

  it('supports full multi-tenant CRM lifecycle for demo store (app + manual customers, notes, tags, order history, hide)', async () => {
    const initial = await customerRepository.getCrmCustomers('tenant-adega-01', {});
    expect(initial.totalCount).toBeGreaterThanOrEqual(3);

    // Both App/Digital and Manual customers exist in the store base
    const hasAppCustomer = initial.customers.some((c) => !c.isManual);
    const hasManualCustomer = initial.customers.some((c) => c.isManual);
    expect(hasAppCustomer).toBe(true);
    expect(hasManualCustomer).toBe(true);

    // Create a new manual customer with initial notes and tags
    const uniquePhone = `(11) 97000-${String(Math.floor(1000 + Math.random() * 8999))}`;
    await customerRepository.createCrmManualCustomer('tenant-adega-01', {
      name: 'Mariana Alencar',
      phone: uniquePhone,
      email: 'mariana.alencar@exemplo.com',
      origin: 'whatsapp',
      consentLgpd: true,
      contactConsent: true,
      notes: 'Cliente presencial cadastrada no balcão',
      tags: ['VIP', 'Prefere Retirada'],
    });

    const afterCreate = await customerRepository.getCrmCustomers('tenant-adega-01', {
      search: 'Mariana Alencar',
    });
    expect(afterCreate.customers).toHaveLength(1);
    const created = afterCreate.customers[0];
    expect(created.isManual).toBe(true);
    expect(created.email).toBe('mariana.alencar@exemplo.com');
    expect(created.contactConsent).toBe(true);
    expect(created.hasLgpdConsent).toBe(true);
    expect(created.tags).toEqual(['VIP', 'Prefere Retirada']);

    // Duplicate phone registration in the same tenant is rejected
    await expect(
      customerRepository.createCrmManualCustomer('tenant-adega-01', {
        name: 'Outra Mariana',
        phone: uniquePhone,
        origin: 'direct',
        consentLgpd: true,
        contactConsent: false,
      })
    ).rejects.toThrow(/Já existe um cliente cadastrado com este telefone/);

    // Edit manual customer data and private notes/tags
    await customerRepository.updateCrmManualCustomer('tenant-adega-01', created.id, {
      name: 'Mariana Alencar Silva',
      phone: uniquePhone,
      email: 'mariana.silva@exemplo.com',
    });
    await customerRepository.saveCrmCustomerPrivateData(
      'tenant-adega-01',
      created.id,
      'Prefere entrega às sextas-feiras',
      ['VIP', 'Sexta-feira']
    );

    const afterUpdate = await customerRepository.getCrmCustomers('tenant-adega-01', {
      search: 'Mariana Alencar Silva',
    });
    expect(afterUpdate.customers[0].name).toBe('Mariana Alencar Silva');
    expect(afterUpdate.customers[0].notes).toBe('Prefere entrega às sextas-feiras');
    expect(afterUpdate.customers[0].tags).toEqual(['VIP', 'Sexta-feira']);

    // App customer cannot be edited via updateCrmManualCustomer
    const appCust = initial.customers.find((c) => !c.isManual)!;
    await expect(
      customerRepository.updateCrmManualCustomer('tenant-adega-01', appCust.id, {
        name: 'Tentativa Indevida',
        phone: '11999990000',
      })
    ).rejects.toThrow(/Somente registros manuais desta loja podem ser editados/);

    // Order history for Renato Sampaio (cust-adega-1) includes items and payment/fulfillment details
    const history = await customerRepository.getCrmCustomerOrderHistory(
      'tenant-adega-01',
      'cust-adega-1'
    );
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].orderNumber).toBe(1001);
    expect(history[0].items?.length).toBeGreaterThan(0);

    // Hide manual customer from store list without deleting underlying record
    await customerRepository.hideCrmCustomer('tenant-adega-01', created.id);
    const afterHide = await customerRepository.getCrmCustomers('tenant-adega-01', {
      search: 'Mariana Alencar Silva',
    });
    expect(afterHide.customers).toHaveLength(0);

    // Tenant isolation: tenant-burger-02 never sees tenant-adega-01 customers
    const burgerCustomers = await customerRepository.getCrmCustomers('tenant-burger-02', {});
    expect(burgerCustomers.customers.some((c) => c.id === 'cust-adega-1')).toBe(false);
  });

  it('calculates and provides store-wide overview metrics independently of pagination', async () => {
    const metrics = await customerRepository.getCrmOverviewMetrics('tenant-adega-01');
    expect(metrics.totalCustomers).toBeGreaterThanOrEqual(3);
    expect(metrics.totalRevenue).toBeGreaterThan(0);
    expect(metrics.averageTicket).toBeGreaterThan(0);
  });
});
