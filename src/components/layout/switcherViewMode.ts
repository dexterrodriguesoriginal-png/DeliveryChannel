// Regras puras do modo do modal "Minha Conta" (RoleTenantSwitcher).
export type SwitcherViewMode = 'LOGIN' | 'SIGNUP' | 'FORGOT' | 'ACCOUNT';

/** Modo inicial/sincronizado: autenticado abre direto em ACCOUNT. */
export const viewModeFor = (isSupabaseAuth: boolean): SwitcherViewMode =>
  isSupabaseAuth ? 'ACCOUNT' : 'LOGIN';

/** O fechamento automático só vale para o fluxo de login/cadastro em andamento. */
export const shouldAutoCloseAfterAuth = (
  isOpen: boolean,
  viewMode: SwitcherViewMode,
  authState: string,
): boolean =>
  isOpen &&
  (viewMode === 'LOGIN' || viewMode === 'SIGNUP') &&
  (authState === 'AUTHENTICATED_WITH_MEMBERSHIP' ||
    authState === 'AUTHENTICATED_WITHOUT_MEMBERSHIP' ||
    authState === 'EMAIL_CONFIRMATION_REQUIRED');
