// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WaiterAccessBlock } from '../WaiterAccessBlock';

afterEach(cleanup);
describe('WaiterAccessBlock', () => {
  it('QR + link + WhatsApp + 3 passos, com o e-mail do convite', () => {
    render(<WaiterAccessBlock email="ana@loja.com" storeName="Bar do Zé" origin="https://x.app" />);
    expect(screen.getByTestId('waiter-access-qr').querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('waiter-access-url').textContent).toBe('https://x.app/garcom?email=ana%40loja.com');
    expect(screen.getByRole('button', { name: 'Copiar link' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Enviar pelo WhatsApp' }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/ESTE e-mail/)).toBeTruthy();
  });
});
