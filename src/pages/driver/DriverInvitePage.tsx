import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Bike, AlertCircle, LogIn, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { RoleTenantSwitcher } from '../../components/layout/RoleTenantSwitcher';
import type { SwitcherInitialView } from '../../components/layout/switcherViewMode';
import { CustomerEmailConfirmNotice } from '../../components/client/CustomerEmailConfirmNotice';
import { driverInviteRepository, DriverInvitePreview } from '../../repositories/driverRepository';
import { applyDriverRedeem, rememberInviteStore, startDriverGoogleAuth, DRIVER_AUTH_RETURN_TO, storeInitials, rememberInviteToken, clearInviteToken } from '../../lib/driverInviteFlow';
import { DriverStatusScreen } from './DriverStatusScreen';
import { INVITE_TOKEN_SESSION_KEY } from '../../utils/inviteUrl';
import type { DriverScreenVariant } from '../../lib/membershipResolution';

export const INVALID_INVITE_MESSAGE = 'Convite inválido ou expirado. Peça um novo link à loja.';

/** Logo da loja ou placeholder com as iniciais, nas cores do app do entregador. */
export const StoreLogo: React.FC<{ name?: string; logo?: string | null }> = ({ name, logo }) => {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return <img src={logo} alt={name || 'Loja'} onError={() => setFailed(true)} className="w-16 h-16 rounded-2xl object-cover mx-auto" />;
  }
  return (
    <div data-testid="store-logo-placeholder" className="w-16 h-16 rounded-2xl bg-amber-500 text-black flex items-center justify-center font-bold text-xl mx-auto">
      {storeInitials(name)}
    </div>
  );
};

const Header: React.FC = () => (
  <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30 flex items-center gap-2.5 shadow-xs">
    <div className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold">
      <Bike className="w-5 h-5" />
    </div>
    <h1 className="text-sm font-bold text-gray-900 leading-tight">Delivery Channel Entregador</h1>
  </div>
);

export interface DriverInviteViewProps {
  state: 'LOADING' | 'INVALID' | 'VALID';
  preview?: DriverInvitePreview | null;
  hasSession: boolean;
  isRedeeming?: boolean;
  error?: string | null;
  onJoin?: () => void;
  onSignUp?: () => void;
  onLogin?: () => void;
  onGoogle?: () => void;
  /** Cadastro feito aguardando confirmação: aviso persistente com "Reenviar e-mail". */
  confirmationEmail?: string | null;
  onResendConfirmation?: (email: string) => Promise<{ success: boolean; error?: string }>;
}

/** Texto do aviso de confirmação no convite (depois de confirmar, o link volta para este convite). */
export const driverConfirmHint = (storeName?: string | null) =>
  `Depois de confirmar, você volta para este convite e já pode entrar na equipe da ${(storeName || '').trim() || 'loja'}.`;

/** Parte visual da página do convite (testável sem rede). */
export const DriverInviteView: React.FC<DriverInviteViewProps> = ({ state, preview, hasSession, isRedeeming, error, onJoin, onSignUp, onLogin, onGoogle, confirmationEmail, onResendConfirmation }) => (
  <div className="min-h-screen bg-gray-50 pb-24 text-gray-900 font-sans">
    <Header />
    <div className="max-w-lg mx-auto p-4">
      <Card className="p-6 text-center space-y-3">
        {state === 'LOADING' && <p className="text-xs text-gray-500">Carregando convite...</p>}
        {state === 'INVALID' && (
          <>
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <AlertCircle className="w-7 h-7" />
            </div>
            <p className="text-sm font-semibold text-gray-800">{INVALID_INVITE_MESSAGE}</p>
          </>
        )}
        {state === 'VALID' && preview && (
          <>
            <StoreLogo name={preview.storeName} logo={preview.storeLogo} />
            <h2 className="text-lg font-bold text-gray-900">{preview.storeName}</h2>
            <p className="text-xs text-gray-500">Convite para se cadastrar como entregador desta loja.</p>
            {preview.expiresAt && (
              <p className="text-[11px] text-gray-500">Válido até {new Date(preview.expiresAt).toLocaleString('pt-BR')}</p>
            )}
            {error && <p className="text-xs text-rose-700">{error}</p>}
            {hasSession ? (
              <Button onClick={onJoin} disabled={isRedeeming} className="w-full cursor-pointer">
                {isRedeeming ? 'Entrando...' : 'Entrar na equipe'}
              </Button>
            ) : confirmationEmail ? (
              <div className="text-left">
                <CustomerEmailConfirmNotice
                  email={confirmationEmail}
                  kind="signup"
                  onResend={onResendConfirmation || (async () => ({ success: false }))}
                  onBackToLogin={onLogin}
                  afterConfirmHint={driverConfirmHint(preview.storeName)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={onGoogle} className="w-full cursor-pointer">Continuar com Google</Button>
                <Button onClick={onSignUp} leftIcon={<UserPlus className="w-4 h-4" />} className="w-full cursor-pointer">Criar conta</Button>
                <Button variant="outline" onClick={onLogin} leftIcon={<LogIn className="w-4 h-4" />} className="w-full cursor-pointer">Já tenho conta</Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  </div>
);

/** Página pública /entregador/convite/:token (F7). O token nunca vai para console, analytics ou localStorage. */
export const DriverInvitePage: React.FC<{ token: string }> = ({ token }) => {
  const { supabaseUser, switchTenant, signInWithGoogle, signOut, currentUser, authState, pendingConfirmationEmail, resendConfirmationEmail } = useAuth();
  const [state, setState] = useState<'LOADING' | 'INVALID' | 'VALID'>('LOADING');
  const [preview, setPreview] = useState<DriverInvitePreview | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<DriverScreenVariant | null>(null);
  const [resultTenantId, setResultTenantId] = useState<string | null>(null);
  const autoRedeemed = useRef<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authView, setAuthView] = useState<SwitcherInitialView>('SIGNUP');
  const [signupEmail, setSignupEmail] = useState<string | null>(null);
  // Aviso persistente: cadastro feito agora ou confirmação pendente nesta aba (sobrevive a recarregar).
  const confirmationEmail = supabaseUser ? null
    : (signupEmail || (authState === 'EMAIL_CONFIRMATION_REQUIRED' ? pendingConfirmationEmail : null));

  useEffect(() => {
    let alive = true;
    driverInviteRepository.previewInvite(token)
      .then(p => { if (alive) { setPreview(p); setState(p.valid ? 'VALID' : 'INVALID'); } })
      .catch(() => { if (alive) setState('INVALID'); });
    return () => { alive = false; };
  }, [token]);

  const goToAuth = (view: SwitcherInitialView) => {
    rememberInviteToken(sessionStorage, token);
    sessionStorage.setItem('adegafood_auth_return_to', DRIVER_AUTH_RETURN_TO);
    if (view === 'LOGIN') setSignupEmail(null);
    setAuthView(view);
    setAuthOpen(true);
  };

  const handleJoin = useCallback(async () => {
    setIsRedeeming(true);
    setError(null);
    try {
      const result = await driverInviteRepository.redeemInvite(token);
      rememberInviteStore(sessionStorage, result.tenantId, preview?.storeName);
      const outcome = await applyDriverRedeem(result, switchTenant);
      if (outcome.kind === 'INVALID') { setState('INVALID'); return; }
      clearInviteToken(sessionStorage, window.history);
      sessionStorage.removeItem('adegafood_auth_return_to');
      sessionStorage.removeItem('adegafood_auth_intent');
      setResultTenantId(outcome.tenantId);
      if (outcome.kind === 'GO_APP') { window.location.replace('/entregador'); return; }
      if (outcome.kind === 'STATUS') { setStatusVariant(outcome.variant); return; }
      setStatusVariant('PENDING');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível concluir a ação. Tente novamente.');
    } finally {
      setIsRedeeming(false);
    }
  }, [token, switchTenant, preview?.storeName]);

  // E-mail/Google confirmados voltam ao mesmo convite e usam a sessão existente, sem novo cadastro.
  useEffect(() => {
    if (!supabaseUser || state !== 'VALID' || sessionStorage.getItem(INVITE_TOKEN_SESSION_KEY) !== token) return;
    const key = `${supabaseUser.id}:${token}`;
    if (autoRedeemed.current === key) return;
    autoRedeemed.current = key;
    setAuthOpen(false);
    void handleJoin();
  }, [supabaseUser?.id, state, token, handleJoin]);

  const refreshStatus = async () => {
    if (!resultTenantId) return;
    try {
      const approval = await driverInviteRepository.getOwnApprovalStatus(resultTenantId);
      if (!await switchTenant(resultTenantId)) throw new Error('Não foi possível abrir esta loja.');
      if (approval === 'APPROVED') { window.location.replace('/entregador'); return; }
      setStatusVariant(approval === 'NONE' ? 'INACTIVE' : approval || 'UNAVAILABLE');
    } catch { setStatusVariant('UNAVAILABLE'); }
  };

  if (statusVariant) {
    return (
      <DriverStatusScreen
        variant={statusVariant}
        storeName={preview?.storeName}
        userName={currentUser?.name}
        onRefresh={statusVariant === 'PENDING' || statusVariant === 'UNAVAILABLE' ? refreshStatus : undefined}
        onSignOut={async () => { await signOut(); window.location.replace('/'); }}
      />
    );
  }

  return (
    <>
      <DriverInviteView
        state={state}
        preview={preview}
        hasSession={!!supabaseUser}
        isRedeeming={isRedeeming}
        error={error}
        onJoin={handleJoin}
        onSignUp={() => goToAuth('SIGNUP')}
        onLogin={() => goToAuth('LOGIN')}
        onGoogle={() => {
          void startDriverGoogleAuth(sessionStorage, token, signInWithGoogle)
            .catch(() => setError('Não foi possível entrar com o Google. Tente novamente.'));
        }}
        confirmationEmail={confirmationEmail}
        onResendConfirmation={(email) => resendConfirmationEmail(email)}
      />
      <RoleTenantSwitcher
        key={authView}
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onStartOnboarding={() => setAuthOpen(false)}
        initialView={authView}
        audience="driver"
        storeName={preview?.storeName}
        googleReturnTo={DRIVER_AUTH_RETURN_TO}
        onEmailConfirmationRequired={(email) => setSignupEmail(email)}
      />
    </>
  );
};
