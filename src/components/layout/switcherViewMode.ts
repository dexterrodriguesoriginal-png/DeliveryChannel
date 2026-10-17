// Regras puras do modo do modal "Minha Conta" (RoleTenantSwitcher).
export type SwitcherViewMode = 'LOGIN' | 'SIGNUP' | 'FORGOT' | 'ACCOUNT';

/** Tela pedida por quem abre o modal sem sessão ("Criar conta" → SIGNUP, "Já tenho conta" → LOGIN). */
export type SwitcherInitialView = 'LOGIN' | 'SIGNUP';

/** Modo inicial/sincronizado: autenticado abre direto em ACCOUNT; sem sessão, na tela pedida (padrão LOGIN). */
export const viewModeFor = (isSupabaseAuth: boolean, initialView: SwitcherInitialView = 'LOGIN'): SwitcherViewMode =>
  isSupabaseAuth ? 'ACCOUNT' : initialView;

/** Público do modal: dono de estabelecimento (padrão) ou entregador vindo do convite. */
export type SwitcherAudience = 'owner' | 'driver';

export interface AuthModalCopy {
  loginSubtitle: string;
  loginButton: string;
  signupSubtitle: string;
}

/** Textos do modal de login/cadastro por público. O texto do dono não muda. */
export function authModalCopy(audience: SwitcherAudience = 'owner', storeName?: string | null): AuthModalCopy {
  if (audience === 'driver') {
    const store = (storeName || '').trim() || 'loja';
    return {
      loginSubtitle: `Entre para aceitar o convite de entregador da ${store}.`,
      loginButton: 'Entrar',
      signupSubtitle: `Crie sua conta de entregador para começar a fazer entregas pela ${store}.`,
    };
  }
  return {
    loginSubtitle: 'Acesse seu estabelecimento e gerencie seu negócio.',
    loginButton: 'Entrar no Estabelecimento',
    signupSubtitle: 'Cadastre-se para começar a gerenciar seu estabelecimento.',
  };
}

/** Situação da confirmação de senha calculada só a partir dos valores atuais. */
export type PasswordMatchStatus = 'idle' | 'match' | 'mismatch';
export const passwordMatchStatus = (password: string, confirm: string): PasswordMatchStatus =>
  !password || !confirm ? 'idle' : password === confirm ? 'match' : 'mismatch';

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
