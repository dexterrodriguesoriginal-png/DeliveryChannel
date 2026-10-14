import { describe, it, expect } from 'vitest';
import { viewModeFor, shouldAutoCloseAfterAuth, SwitcherViewMode } from '../switcherViewMode';

// Simula a ordem dos efeitos do RoleTenantSwitcher no commit em que isOpen vira true.
function openModal(initial: SwitcherViewMode, isAuth: boolean, authState: string) {
  const closedByEffect = shouldAutoCloseAfterAuth(true, initial, authState); // efeito 2 lê o estado do render atual
  const next = viewModeFor(isAuth); // efeito 1 agenda o modo sincronizado
  return { closedByEffect, next };
}

describe('RoleTenantSwitcher: modo do modal', () => {
  it('autenticado inicia em ACCOUNT', () => {
    expect(viewModeFor(true)).toBe('ACCOUNT');
    expect(viewModeFor(false)).toBe('LOGIN');
  });
  it('autenticado com loja: abrir o modal NÃO fecha e mostra ACCOUNT', () => {
    const r = openModal(viewModeFor(true), true, 'AUTHENTICATED_WITH_MEMBERSHIP');
    expect(r.closedByEffect).toBe(false);
    expect(r.next).toBe('ACCOUNT');
  });
  it('regressão: com estado inicial LOGIN fixo o modal fechava sozinho', () => {
    expect(openModal('LOGIN', true, 'AUTHENTICATED_WITH_MEMBERSHIP').closedByEffect).toBe(true);
  });
  it('fluxo de login: concluir a autenticação com o modal em LOGIN ainda fecha', () => {
    expect(shouldAutoCloseAfterAuth(true, 'LOGIN', 'AUTHENTICATED_WITH_MEMBERSHIP')).toBe(true);
    expect(shouldAutoCloseAfterAuth(true, 'SIGNUP', 'EMAIL_CONFIRMATION_REQUIRED')).toBe(true);
    expect(shouldAutoCloseAfterAuth(true, 'ACCOUNT', 'AUTHENTICATED_WITH_MEMBERSHIP')).toBe(false);
    expect(shouldAutoCloseAfterAuth(false, 'LOGIN', 'AUTHENTICATED_WITH_MEMBERSHIP')).toBe(false);
    expect(shouldAutoCloseAfterAuth(true, 'LOGIN', 'UNAUTHENTICATED')).toBe(false);
  });
});
