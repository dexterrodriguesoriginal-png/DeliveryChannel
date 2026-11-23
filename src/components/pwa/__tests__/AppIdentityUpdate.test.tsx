// @vitest-environment happy-dom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppIdentityUpdate } from '../AppIdentityUpdate';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await React.act(async () => {
    root.render(<AppIdentityUpdate slug="loja" currentIdentity="0123456789" />);
  });
}
describe('instalação antiga substituída', () => {
  it('bloqueia a tela toda, mostra o texto exato e somente um link HTTPS relativo para a nova versão', async () => {
    await render();
    const screen = container.querySelector('[data-testid="identity-replaced-screen"]') as HTMLElement;
    expect(screen).toBeTruthy();
    expect(screen.style.position).toBe('fixed');
    expect(screen.style.inset).toMatch(/^0(px)?$/);
    expect(screen.textContent).toContain('Esta versão foi substituída. A nova versão já está instalada no seu celular. Remova esta versão e abra a nova.');
    const links = screen.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Abrir nova versão');
    expect(links[0].getAttribute('href')).toBe('/app/loja~0123456789/?source=pwa');
    expect(screen.querySelector('button')).toBeNull();
    expect(screen.innerHTML).not.toContain('intent://');
  });
});
