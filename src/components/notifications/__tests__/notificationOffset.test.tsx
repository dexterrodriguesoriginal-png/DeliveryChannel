// @vitest-environment happy-dom
import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ activeTenant: { id: 'T1' }, supabaseUser: { id: 'U1' }, activeRole: 'OWNER' }),
}));
vi.mock('../../../lib/supabase', () => {
  const ch: any = { on: () => ch, subscribe: () => ch };
  return { supabase: { channel: () => ch, removeChannel: () => Promise.resolve() } };
});
vi.mock('../../../repositories/dispatchChatRepository', () => ({
  dispatchChatRepository: { notifications: () => Promise.resolve([]), visibleNotifications: () => Promise.resolve([]), read: () => Promise.resolve() },
}));
import { OwnerNotifications } from '../OwnerNotifications';
import { BOTTOM_ACTIONS_VAR, FLOAT_LEFT_VAR, FLOAT_RIGHT_VAR, FLOAT_ALIGN_VAR, useBottomActionsOffset, useFloatingLeftOf } from '../../../lib/ui/bottomActionsOffset';

afterEach(() => { cleanup(); document.documentElement.style.removeProperty(BOTTOM_ACTIONS_VAR); });

function SaveBar({ h }: { h: number }) {
  const ref = useRef<HTMLElement>(null);
  useBottomActionsOffset(ref);
  return <footer ref={(el) => { if (el) el.getBoundingClientRect = () => ({ height: h } as DOMRect); (ref as any).current = el; }}>Salvar</footer>;
}

describe('Botão de notificações x barra Salvar do Design do App', () => {
  it('a barra publica sua altura e limpa ao sair da página', () => {
    const ui = render(<SaveBar h={64} />);
    expect(document.documentElement.style.getPropertyValue(BOTTOM_ACTIONS_VAR)).toBe('64px');
    ui.unmount();
    expect(document.documentElement.style.getPropertyValue(BOTTOM_ACTIONS_VAR)).toBe('');
  });
  it('as notificações sobem acima da barra (altura + 12px) e não bloqueiam cliques fora dos próprios botões', async () => {
    const ui = render(<><SaveBar h={64} /><OwnerNotifications onOpen={vi.fn()} /></>);
    const aside = await waitFor(() => ui.getByTestId('owner-notifications'));
    expect(aside.getAttribute('style')).toContain(`calc(var(${BOTTOM_ACTIONS_VAR}, 0px) + 12px)`);
    expect(aside.className).toContain('pointer-events-none');
    expect(aside.className).toContain('[&>*]:pointer-events-auto');
    // abaixo da barra de ações? não: z-index menor que diálogos (1200) e o rodapé fica livre
    expect(aside.className).toContain('z-[60]');
  });
  it('com coluna de celular à direita, o botão vai para o canto inferior esquerdo da área de conteúdo e volta ao sair', () => {
    function Content() {
      const ref = useRef<HTMLElement>(null);
      useFloatingLeftOf(ref);
      return <main ref={(el) => { if (el) el.getBoundingClientRect = () => ({ left: 276 } as DOMRect); (ref as any).current = el; }}>conteúdo</main>;
    }
    const root = document.documentElement;
    const ui = render(<Content />);
    expect(root.style.getPropertyValue(FLOAT_LEFT_VAR)).toBe('288px');
    expect(root.style.getPropertyValue(FLOAT_RIGHT_VAR)).toBe('auto');
    expect(root.style.getPropertyValue(FLOAT_ALIGN_VAR)).toBe('flex-start');
    ui.unmount();
    expect(root.style.getPropertyValue(FLOAT_LEFT_VAR)).toBe('');
    expect(root.style.getPropertyValue(FLOAT_RIGHT_VAR)).toBe('');
  });
  it('o aside das notificações usa variáveis de lado (direita por padrão, 12px)', async () => {
    const ui = render(<OwnerNotifications onOpen={vi.fn()} />);
    const aside = await waitFor(() => ui.getByTestId('owner-notifications'));
    const st = aside.getAttribute('style') || '';
    expect(st).toContain(`var(${FLOAT_RIGHT_VAR}, 12px)`);
    expect(st).toContain(`var(${FLOAT_LEFT_VAR}, auto)`);
  });
});

describe('Botão arrastável: posição salva por usuário', () => {
  const POS_KEY = 'dc:notifications:pos:U1';
  const setup = () => { Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true }); Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true }); };
  afterEach(() => { localStorage.removeItem(POS_KEY); });
  it('usa a posição salva (encaixada na borda) no lugar do canto padrão e mantém dentro da tela', async () => {
    setup(); localStorage.setItem(POS_KEY, JSON.stringify({ edge: 'left', t: 0 }));
    const ui = render(<OwnerNotifications onOpen={vi.fn()} />);
    const aside = await waitFor(() => ui.getByTestId('owner-notifications'));
    expect(aside.getAttribute('data-custom-position')).toBe('true');
    expect(aside.style.left).toBe('12px'); expect(aside.style.top).toBe('12px');
    expect(aside.getAttribute('style')).not.toContain('--dc-float');
  });
  it('arrastar salva a borda mais próxima e não abre o painel; Restaurar posição volta ao canto padrão', async () => {
    setup();
    const ui = render(<OwnerNotifications onOpen={vi.fn()} />);
    const pill = await waitFor(() => ui.getByTestId('notifications-pill'));
    pill.getBoundingClientRect = () => ({ left: 1158, top: 704, width: 196, height: 52, right: 1354, bottom: 756, x: 1158, y: 704, toJSON() {} } as DOMRect);
    (pill as any).setPointerCapture = () => {};
    fireEvent.pointerDown(pill, { pointerId: 1, clientX: 1200, clientY: 720, button: 0 });
    fireEvent.pointerMove(pill, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerUp(pill, { pointerId: 1, clientX: 300, clientY: 400 });
    const saved = JSON.parse(localStorage.getItem(POS_KEY)!);
    expect(['left', 'top']).toContain(saved.edge); expect(saved.t).toBeGreaterThanOrEqual(0); expect(saved.t).toBeLessThanOrEqual(1);
    const aside = ui.getByTestId('owner-notifications');
    expect(aside.getAttribute('data-custom-position')).toBe('true');
    expect(ui.queryByTestId('notification-panel')).toBeNull();
    // o clique logo após soltar é ignorado; um clique normal depois abre o painel
    fireEvent.click(ui.getByRole('button', { name: /Notificações, 0 não lidas/ })); expect(ui.queryByTestId('notification-panel')).toBeNull();
    await new Promise(r => setTimeout(r, 5));
    fireEvent.click(ui.getByRole('button', { name: /Notificações, 0 não lidas/ }));
    const panel = await waitFor(() => ui.getByTestId('notification-panel'));
    fireEvent.click(ui.getByText('Restaurar posição'));
    expect(localStorage.getItem(POS_KEY)).toBeNull();
    expect(ui.getByTestId('owner-notifications').getAttribute('data-custom-position')).toBeNull();
    expect(panel).toBeTruthy();
  });
  it('o painel nunca invade a barra Salvar: altura máxima respeita o espaço acima dela', async () => {
    setup(); document.documentElement.style.setProperty(BOTTOM_ACTIONS_VAR, '64px');
    localStorage.setItem(POS_KEY, JSON.stringify({ edge: 'left', t: 0 }));
    const ui = render(<OwnerNotifications onOpen={vi.fn()} />);
    fireEvent.click(await waitFor(() => ui.getByRole('button', { name: /Notificações,/ })));
    const panel = await waitFor(() => ui.getByTestId('notification-panel'));
    const top = parseFloat(panel.style.top), maxH = parseFloat(panel.style.maxHeight);
    expect(top + maxH).toBeLessThanOrEqual(768 - 64 - 12);
  });
});
