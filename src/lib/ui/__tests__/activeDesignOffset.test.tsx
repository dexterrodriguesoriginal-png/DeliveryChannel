// @vitest-environment happy-dom
import React, { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BOTTOM_ACTIONS_VAR, FLOAT_LEFT_VAR, useBottomActionsOffset, useFloatingLeftOf } from '../bottomActionsOffset';
function Design({ active, height, left }: { active: boolean; height: number; left: number }) {
  const ref = useRef<HTMLElement>(null);
  useBottomActionsOffset(ref, active);
  useFloatingLeftOf(ref, 12, active);
  return <section hidden={!active} ref={element => { ref.current = element; if (element) element.getBoundingClientRect = () => ({ height, left } as DOMRect); }} />;
}
afterEach(cleanup);
it('somente o editor visível posiciona as notificações acima da própria barra de ações', () => {
  const editors = (menu: boolean) => <><Design active={!menu} height={64} left={20} /><Design active={menu} height={90} left={40} /></>;
  const view = render(editors(false));
  const style = document.documentElement.style;
  expect(style.getPropertyValue(BOTTOM_ACTIONS_VAR)).toBe('64px'); expect(style.getPropertyValue(FLOAT_LEFT_VAR)).toBe('32px');
  view.rerender(editors(true));
  expect(style.getPropertyValue(BOTTOM_ACTIONS_VAR)).toBe('90px'); expect(style.getPropertyValue(FLOAT_LEFT_VAR)).toBe('52px');
  view.rerender(editors(false));
  expect(style.getPropertyValue(BOTTOM_ACTIONS_VAR)).toBe('64px'); expect(style.getPropertyValue(FLOAT_LEFT_VAR)).toBe('32px');
  view.unmount(); expect(style.getPropertyValue(BOTTOM_ACTIONS_VAR)).toBe(''); expect(style.getPropertyValue(FLOAT_LEFT_VAR)).toBe('');
});
