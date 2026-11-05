import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_DESIGN, type HomeAction } from '../storeHome.model';
import { homeActionAvailability, visibleHomeActions } from '../storeHomeVisibility';

describe('storeHomeVisibility', () => {
  const base = {
    ...DEFAULT_HOME_DESIGN,
    actions: ['MENU', 'TABLE', 'PICKUP', 'DELIVERY', 'ACCOUNT', 'WAITER', 'BILL'] as HomeAction[],
  };

  it('esconde mesa/garçom/conta quando salão está desligado', () => {
    expect(visibleHomeActions(base, {
      dineIn: false, delivery: true, pickup: true, kiosk: false,
    })).toEqual(['MENU', 'PICKUP', 'DELIVERY', 'ACCOUNT']);
  });

  it('esconde delivery e pickup conforme módulos e totem', () => {
    expect(visibleHomeActions(base, {
      dineIn: true, delivery: false, pickup: true, kiosk: false,
    })).toEqual(['MENU', 'TABLE', 'PICKUP', 'ACCOUNT', 'WAITER', 'BILL']);

    expect(visibleHomeActions(base, {
      dineIn: true, delivery: true, pickup: true, kiosk: true,
    })).toEqual(['MENU']);
  });

  it('disponibilidade de garçom/conta depende da sessão', () => {
    const availability = homeActionAvailability([...base.actions], {
      hasSession: false,
      waiterEnabled: true,
      billEnabled: true,
    });
    expect(availability.MENU).toBe(true);
    expect(availability.ACCOUNT).toBe(false);
    expect(availability.WAITER).toBe(false);
    expect(availability.BILL).toBe(false);
  });
});
