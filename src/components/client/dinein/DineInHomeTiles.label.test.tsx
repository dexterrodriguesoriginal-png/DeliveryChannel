// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DineInHomeTiles } from './DineInHomeTiles';

const base = { storeName: 'Loja', tableName: 'Mesa 1', onOpenMenu: vi.fn(), onCallWaiter: vi.fn(), onRequestBill: vi.fn(), waiterDisabled: false, billDisabled: false };

describe('DineInHomeTiles menu label', () => {
  afterEach(cleanup);
  it('defaults to Cardápio', () => {
    render(<DineInHomeTiles {...base} />);
    expect(screen.getByRole('button', { name: 'Cardápio' })).toBeTruthy();
  });
  it('shows the owner-defined label as text (never as HTML)', () => {
    render(<DineInHomeTiles {...base} menuLabel="Nosso cardápio" />);
    expect(screen.getByRole('button', { name: 'Nosso cardápio' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nosso cardápio' })).toBeTruthy();
  });
});
