import { describe, it, expect } from 'vitest';
import { installHintBottomOffset, CUSTOMER_BOTTOM_NAV_PX, FLOATING_CART_BAR_PX } from '../installHintLayout';

describe('installHintBottomOffset', () => {
  it('fica acima da navegação inferior (Sacola/Pedidos)', () => {
    expect(installHintBottomOffset({ bottomNav: true, floatingCartBar: false })).toBeGreaterThan(CUSTOMER_BOTTOM_NAV_PX);
  });
  it('com a barra "Ver Sacola" visível, sobe acima dela também', () => {
    expect(installHintBottomOffset({ bottomNav: true, floatingCartBar: true }))
      .toBeGreaterThan(CUSTOMER_BOTTOM_NAV_PX + FLOATING_CART_BAR_PX);
  });
  it('sem navegação, mantém só a folga', () => {
    expect(installHintBottomOffset({ bottomNav: false, floatingCartBar: false })).toBe(8);
  });
});
