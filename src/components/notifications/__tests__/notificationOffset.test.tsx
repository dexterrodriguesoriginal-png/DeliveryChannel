// @vitest-environment happy-dom
import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
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
import { BOTTOM_ACTIONS_VAR, useBottomActionsOffset } from '../../../lib/ui/bottomActionsOffset';

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
});
