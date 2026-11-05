// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOME_DESIGN } from '../../../../lib/storeHome/storeHome.model';
import { StoreHomeScreen } from '../StoreHomeScreen';

afterEach(cleanup);

describe('StoreHomeScreen', () => {
  it('renderiza tiles com glow e dispara ações', () => {
    const onAction = vi.fn();
    render(
      <StoreHomeScreen
        design={DEFAULT_HOME_DESIGN}
        storeName="ADEGASSHOW"
        menuLabel="Cardápio"
        onAction={onAction}
        visibility={{ dineIn: true, delivery: true, pickup: true, kiosk: false }}
      />,
    );
    expect(screen.getByTestId('dinein-home')).toBeTruthy();
    expect(screen.getByText('ADEGASSHOW')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cardápio' }));
    expect(onAction).toHaveBeenCalledWith('MENU');
  });

  it('oculta delivery quando módulo desligado', () => {
    render(
      <StoreHomeScreen
        design={DEFAULT_HOME_DESIGN}
        storeName="Loja"
        visibility={{ dineIn: true, delivery: false, pickup: true, kiosk: false }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Pedir Delivery' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pedir para Retirar' })).toBeTruthy();
  });
});
