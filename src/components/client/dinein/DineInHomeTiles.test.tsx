// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DineInHomeTiles, type DineInHomeTilesProps } from './DineInHomeTiles';

afterEach(cleanup);
const props = (): DineInHomeTilesProps => ({
  storeName: 'Café da Praça', tableName: 'Mesa 7', logoUrl: '/logo.png', menuImageUrl: '/lanche.jpg',
  storeAppHref: '/app/cafe-da-praca', onOpenMenu: vi.fn(), onCallWaiter: vi.fn(), onRequestBill: vi.fn(),
  waiterDisabled: false, billDisabled: false,
});

describe('início do QR da mesa', () => {
  it('mostra a identidade da loja e oferece somente os atalhos existentes', () => {
    const p = props(); render(<DineInHomeTiles {...p} />);
    expect(screen.getByRole('img', { name: 'Café da Praça' }).getAttribute('src')).toBe('/logo.png');
    expect(screen.getByText('Mesa 7 · No seu tempo')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Cardápio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chamar garçom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pedir minha conta' }));
    expect(p.onOpenMenu).toHaveBeenCalledOnce();
    expect(p.onCallWaiter).toHaveBeenCalledOnce();
    expect(p.onRequestBill).toHaveBeenCalledOnce();
    const app = screen.getByRole('link', { name: 'Meu app' });
    expect(app.getAttribute('href')).toBe('/app/cafe-da-praca');
    expect(app.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('respeita a liberação dos serviços da mesa sem bloquear a consulta ao cardápio', () => {
    const p = props();
    render(<DineInHomeTiles {...p} waiterDisabled billDisabled actionHint="Aguarde a liberação da mesa." />);
    fireEvent.click(screen.getByRole('button', { name: 'Chamar garçom' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pedir minha conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cardápio' }));
    expect(p.onCallWaiter).not.toHaveBeenCalled();
    expect(p.onRequestBill).not.toHaveBeenCalled();
    expect(p.onOpenMenu).toHaveBeenCalledOnce();
    expect(screen.getByText('Aguarde a liberação da mesa.')).toBeTruthy();
  });

  it('encaminha a instalação ao handler existente e não inventa link sem loja resolvida', () => {
    const onStoreAppClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const p = props(); const view = render(<DineInHomeTiles {...p} onStoreAppClick={onStoreAppClick} />);
    fireEvent.click(screen.getByRole('link', { name: 'Meu app' }));
    expect(onStoreAppClick).toHaveBeenCalledOnce();
    view.rerender(<DineInHomeTiles {...p} storeAppHref={undefined} logoUrl={undefined} menuImageUrl={undefined} billLabel="Aguardando PIX" billDisabled />);
    expect(screen.queryByRole('link', { name: 'Meu app' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aguardando PIX' }).hasAttribute('disabled')).toBe(true);
  });
});
